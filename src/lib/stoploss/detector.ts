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

export function createStopLossDetectorState(): StopLossDetectorState {
  return {
    recentBids: [],
    peak: 0,
    activated: false,
    breachStart: 0,
    cooldownUntil: 0,
    waitingForRearm: false,
    dwellGate: new DwellGate(),
  };
}

export function scaledThreshold(price: number, baseThreshold: number): number {
  const p = clamp(price, 0, 1);
  const priceFactor = 1 + PRICE_COEF * (1 - p);
  const thMax = TH_MAX_BASE + TH_MAX_SLOPE * (1 - p);
  return clamp(baseThreshold * priceFactor, TH_MIN, thMax);
}

function thresholdFor(ref: number, config: ResolvedStopLossConfig): number {
  if (config.thresholdMode === 'fixed') {
    return clamp(config.baseThreshold, 0.01, 1);
  }
  return scaledThreshold(ref, config.baseThreshold);
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

  const threshold = thresholdFor(ref, config);
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

  const confirmed = state.dwellGate.feed(breach, now, config.dwellMs);
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

  const dwellRemainingMs = breach && state.breachStart > 0 ? Math.max(0, config.dwellMs - (now - state.breachStart)) : config.dwellMs;

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
    dwellMs: config.dwellMs,
    dwellRemainingMs,
    cooldownUntil: state.cooldownUntil,
  };
}
