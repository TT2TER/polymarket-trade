import { DwellGate, clamp, medianRef, pushBid } from '@/lib/exit/shared';
import type { ResolvedStopLossConfig, StopLossAnchor } from '@/shared/stopLossConfig';

export type StopLossRegime = 'loss-floor' | 'trailing' | 'breakeven' | 'lowprice';

export interface StopLossDetectorState {
  recentBids: number[];
  peak: number;
  activated: boolean;
  breachStart: number;
  cooldownUntil: number;
  waitingForRearm: boolean;
  dwellGate: DwellGate;
  // Phase 2a 波动自适应:环境波动 EWMA(σ_ambient)与计算其增量所需的上一拍快照。
  emaAbsRet: number;
  lastRefPrice: number;
  lastTickAt: number;
}

export interface StopLossEvaluateParams {
  cost: number;
  config: ResolvedStopLossConfig;
}

export interface StopLossEvaluation {
  triggered: boolean;
  ref: number;
  priceNow: number;
  cost: number;
  peak: number;
  activated: boolean;
  exitLine: number;
  regime: StopLossRegime;
  breach: boolean;
  drop: number;
  threshold: number;
  sellFraction: number;
  // dwellMs 报告的是"本拍生效的"dwell(速度自适应后),而非配置的定长值,便于 UI 倒计时与读出。
  dwellMs: number;
  dwellRemainingMs: number;
  cooldownUntil: number;
}

export const DEFAULT_STOP_LOSS_WINDOW_MS = 30_000;
export const DEFAULT_STOP_LOSS_COOLDOWN_MS = 60_000;

const PRICE_COEF = 2;
const TH_MIN = 0.04;
const TH_MAX_BASE = 0.1;
const TH_MAX_SLOPE = 0.3;

// Phase 2a 常数:波动自适应阈值 + 速度自适应 dwell。
// σ_ambient 用"环境波动"(半衰期 ~90s)而非瞬时:单根真事件不会瞬间把阈值撑大、漏掉事件;
// 高波动"无方向来回抽插"才放宽阈值,抓真趋势交给 dwell 确认闸门。
const VOL_EWMA_HALF_LIFE_MS = 90_000;
const SIGMA_REF = 0.02; // 该市场"正常"每拍相对波动基准 = volFactor 的中性点(=1)。
const VOL_MIN = 0.8;
const VOL_MAX = 3;
// 速度自适应 dwell:破位越深,dwell 收得越短(深破/灾难快出);但有下限,仍挡单根深针。
const DWELL_VELOCITY_SCALE = 0.85;
const MIN_DWELL_MS = 600;
const SEVERITY_DEPTH_REF = 0.1; // 跌破退出线 10% 即视作满严重度。

export function createStopLossDetectorState(): StopLossDetectorState {
  return {
    recentBids: [],
    peak: 0,
    activated: false,
    breachStart: 0,
    cooldownUntil: 0,
    waitingForRearm: false,
    dwellGate: new DwellGate(),
    // σ_ambient 播种为"正常波动"基准 → 启动 volFactor=1(=纯价位缩放的 Phase 1 基线),
    // 之后随真实波动上调/下调;避免冷启动时因 0 波动把阈值压到下限。
    emaAbsRet: SIGMA_REF,
    lastRefPrice: 0,
    lastTickAt: 0,
  };
}

export function scaledThreshold(price: number, baseThreshold: number, volFactor = 1): number {
  const p = clamp(price, 0, 1);
  const priceFactor = 1 + PRICE_COEF * (1 - p);
  const thMax = TH_MAX_BASE + TH_MAX_SLOPE * (1 - p);
  // 价位缩放 × 波动缩放,再夹在 [TH_MIN, thMax(p)] 内。
  return clamp(baseThreshold * priceFactor * volFactor, TH_MIN, thMax);
}

function thresholdFor(ref: number, config: ResolvedStopLossConfig, volFactor = 1): number {
  if (config.thresholdMode === 'fixed') {
    return clamp(config.baseThreshold, 0.01, 1);
  }
  return scaledThreshold(ref, config.baseThreshold, volFactor);
}

// 时间感知 EWMA 更新 σ_ambient:按真实 dt 衰减旧值(平静期波动自然回落),再并入本拍相对位移。
// 首拍(lastTickAt=0)用 τ 作中性 dt,使 α≈0.63,不至于过度偏向 0 或瞬时值。
// 把本拍 ref 并入环境波动 EWMA(供"后续拍"的阈值使用,不影响本拍——见 evaluate 中的调用顺序)。
function updateAmbientVol(state: StopLossDetectorState, ref: number, now: number): void {
  if (state.lastRefPrice <= 0) {
    // 首个有效 ref:仅播种 lastRefPrice/lastTickAt,不并入 EWMA(无前值,避免虚假 0 位移)。
    state.lastRefPrice = ref;
    state.lastTickAt = now;
    return;
  }
  const tau = VOL_EWMA_HALF_LIFE_MS / Math.LN2;
  // dt 钳到 [0, τ]:单次更新权重 α ≤ 1−e^-1 ≈ 0.63,避免长间隔后单根 tick 主导"环境"估计。
  const dt = clamp(now - state.lastTickAt, 0, tau);
  const alpha = 1 - Math.exp(-dt / tau);
  const ret = Math.abs(ref - state.lastRefPrice) / state.lastRefPrice;
  state.emaAbsRet = alpha * ret + (1 - alpha) * state.emaAbsRet;
  state.lastRefPrice = ref;
  state.lastTickAt = now;
}

function volFactorFrom(emaAbsRet: number): number {
  return clamp(emaAbsRet / SIGMA_REF, VOL_MIN, VOL_MAX);
}

// 速度自适应 dwell:depth = 跌破退出线的相对深度;severity∈[0,1];越深 dwell 越短(趋近 MIN_DWELL_MS)。
// 注:配置 dwellMs 作为 max,故 dwell 只会被缩短、不会被拉长;dwellMs=0 时仍为 0(立即)。
function velocityDwellMs(configDwellMs: number, ref: number, exitLine: number): number {
  const depth = exitLine > 0 ? clamp((exitLine - ref) / exitLine, 0, 1) : 0;
  const severity = clamp(depth / SEVERITY_DEPTH_REF, 0, 1);
  return clamp(configDwellMs * (1 - DWELL_VELOCITY_SCALE * severity), MIN_DWELL_MS, configDwellMs);
}

export interface StopLossPreview {
  ref: number;
  threshold: number;
  exitLine: number;
  regime: StopLossRegime;
  activated: boolean;
  distance: number | null;
}

// 面板配置预览:假设 peak=ref、波动中性(volFactor=1),近似展示"若此刻按当前设置武装"的退出线。
// 与运行时(历史峰值/真实波动/已激活态/dwell)会有差异,仅用于让滑块所见即所得,不参与真实判定。
export function previewStopLoss(config: ResolvedStopLossConfig, cost: number, ref: number): StopLossPreview {
  if (!(ref > 0) || !(cost > 0)) {
    return { ref: ref > 0 ? ref : 0, threshold: 0, exitLine: 0, regime: 'loss-floor', activated: false, distance: null };
  }

  const threshold = thresholdFor(ref, config);
  const peak = ref;
  let activated = false;
  let exitLine: number;
  let regime: StopLossRegime;

  if (peak < config.lowPriceFloor && config.anchor !== 'cost') {
    exitLine = Math.max(cost - config.cataAbsDrop, cost * config.cataAbsMult);
    regime = 'lowprice';
  } else if (config.anchor === 'cost') {
    exitLine = cost * (1 - config.maxLossPct);
    regime = 'loss-floor';
  } else if (config.anchor === 'peak') {
    exitLine = Math.max(peak * (1 - threshold), config.breakevenFloor ? cost : 0);
    regime = 'trailing';
  } else {
    const profit = (ref - cost) / cost;
    activated = profit >= config.activateProfitPct && ref - cost >= config.minAbsCushion;
    if (activated) {
      const raw = peak * (1 - threshold);
      exitLine = Math.max(raw, config.breakevenFloor ? cost : 0);
      regime = config.breakevenFloor && raw <= cost ? 'breakeven' : 'trailing';
    } else {
      exitLine = cost * (1 - config.maxLossPct);
      regime = 'loss-floor';
    }
  }

  const distance = exitLine > 0 ? (ref - exitLine) / ref : null;
  return { ref, threshold, exitLine, regime, activated, distance };
}

function initialEvaluation(priceNow: number, cost: number, config: ResolvedStopLossConfig): StopLossEvaluation {
  const threshold = thresholdFor(priceNow, config);
  const exitLine = cost * (1 - config.maxLossPct);
  return {
    triggered: false,
    ref: 0,
    priceNow,
    cost,
    peak: 0,
    activated: false,
    exitLine,
    regime: 'loss-floor',
    breach: false,
    drop: 0,
    threshold,
    sellFraction: config.sellFraction,
    dwellMs: config.dwellMs,
    dwellRemainingMs: config.dwellMs,
    cooldownUntil: 0,
  };
}

function shouldPreUpdatePeak(anchor: StopLossAnchor, activated: boolean): boolean {
  return anchor === 'peak' || (anchor === 'activated-trailing' && activated);
}

function computeBreach(regime: StopLossRegime, ref: number, exitLine: number): boolean {
  return regime === 'loss-floor' ? ref <= exitLine : ref < exitLine;
}

export function evaluate(
  state: StopLossDetectorState,
  priceNow: number,
  now: number,
  params: StopLossEvaluateParams,
): StopLossEvaluation {
  const { config, cost } = params;
  if (!Number.isFinite(priceNow) || priceNow <= 0 || !Number.isFinite(cost) || cost <= 0) {
    return initialEvaluation(priceNow, cost, config);
  }

  pushBid(state.recentBids, priceNow, config.refK);
  const ref = medianRef(state.recentBids);
  if (ref <= 0) {
    return initialEvaluation(priceNow, cost, config);
  }

  if (state.peak <= 0) {
    state.peak = ref;
  }

  // 用"上一拍的环境波动"算本拍阈值:本拍的瞬时位移只并入 EWMA 供后续拍使用,
  // 真正分离"环境 vs 瞬时",避免长间隔后单根大跌瞬间撑大阈值、漏掉本拍真跌。
  const volFactor = volFactorFrom(state.emaAbsRet);
  const threshold = thresholdFor(ref, config, volFactor);
  let exitLine: number;
  let regime: StopLossRegime;

  if (shouldPreUpdatePeak(config.anchor, state.activated)) {
    state.peak = Math.max(state.peak, ref);
  }

  const observedPeak = Math.max(state.peak, ref);
  if (observedPeak < config.lowPriceFloor && config.anchor !== 'cost') {
    state.peak = observedPeak;
    exitLine = Math.max(cost - config.cataAbsDrop, cost * config.cataAbsMult);
    regime = 'lowprice';
  } else if (config.anchor === 'cost') {
    exitLine = cost * (1 - config.maxLossPct);
    regime = 'loss-floor';
  } else if (config.anchor === 'peak') {
    exitLine = Math.max(state.peak * (1 - threshold), config.breakevenFloor ? cost : 0);
    regime = 'trailing';
  } else if (config.anchor === 'activated-trailing') {
    if (!state.activated) {
      const profit = (ref - cost) / cost;
      if (profit >= config.activateProfitPct && ref - cost >= config.minAbsCushion) {
        state.activated = true;
        state.peak = Math.max(state.peak, ref);
      }
    }

    if (state.activated) {
      const raw = state.peak * (1 - threshold);
      exitLine = Math.max(raw, config.breakevenFloor ? cost : 0);
      regime = config.breakevenFloor && raw <= cost ? 'breakeven' : 'trailing';
    } else {
      exitLine = cost * (1 - config.maxLossPct);
      regime = 'loss-floor';
    }
  } else {
    exitLine = cost * (1 - config.maxLossPct);
    regime = 'loss-floor';
  }

  const breach = computeBreach(regime, ref, exitLine);
  if (state.waitingForRearm && now >= state.cooldownUntil && !breach) {
    state.waitingForRearm = false;
  }

  // 速度自适应:破得越深,dwell 越短(深破快出)。
  const dwellEff = velocityDwellMs(config.dwellMs, ref, exitLine);
  const confirmed = state.dwellGate.feed(breach, now, dwellEff);
  state.breachStart = state.dwellGate.breachStart;
  const blocked = now < state.cooldownUntil || state.waitingForRearm;
  const triggered = confirmed && !blocked;
  const drop = exitLine > 0 ? Math.max(0, (exitLine - ref) / exitLine) : 0;

  if (triggered) {
    state.cooldownUntil = now + config.cooldownMs;
    state.waitingForRearm = true;
    state.dwellGate.reset();
    state.breachStart = 0;
  }

  // 末尾才把本拍并入环境波动,供后续拍的阈值使用(本拍阈值已用上一拍的 emaAbsRet)。
  updateAmbientVol(state, ref, now);

  const dwellRemainingMs =
    breach && state.breachStart > 0 ? Math.max(0, dwellEff - (now - state.breachStart)) : dwellEff;

  return {
    triggered,
    ref,
    priceNow,
    cost,
    peak: state.peak,
    activated: state.activated,
    exitLine,
    regime,
    breach,
    drop,
    threshold,
    sellFraction: config.sellFraction,
    dwellMs: dwellEff,
    dwellRemainingMs,
    cooldownUntil: state.cooldownUntil,
  };
}
