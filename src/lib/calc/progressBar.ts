/*
 * 折叠行进度条:双锚点模型(详见设计讨论)。
 *
 * 模式 A(盈利 / 浅亏 ≤15%):
 *   - 入场价 entry 钉在 15%,目标价 target(N×均价,封顶 0.999)钉在 70%。
 *   - 黄色竖线 = 目标(targetPos 恒为 0.70),永不消失;现价填充相对它移动。
 *   - 左 15% 区线性映射 0→15% 亏损(左缘价 = entry×0.85),浅亏落此区(绿)。
 *   - 右 30% = 超额余量(现价涨过目标时填充进此段)。
 * 模式 B(深亏 >15%):
 *   - 整条线性映射 价格 0(亏光)→ entry(平仓);绿色填充亏损段 [现价, entry]。
 *   - 无目标黄线。
 */

export const ENTRY_POS = 0.15;
export const TARGET_POS = 0.7;
export const PRICE_MAX = 0.999;
export const LOSS_SWITCH = 0.15; // 亏损超过此比例切换到模式 B

export type ProgressMode = 'profit' | 'loss';
export type FillSide = 'up' | 'down'; // up=红(盈)、down=绿(亏)

export interface ProgressBar {
  mode: ProgressMode;
  entry: number;
  current: number;
  /** 模式 A:目标价(已封顶);模式 B:undefined */
  target?: number;
  /** 模式 A:目标是否可达(未撞 $0.999 上限) */
  reachable?: boolean;
  /** 各锚点在轨道上的比例 0..1 */
  entryPos: number;
  currentPos: number;
  /** 模式 A 才有(黄线);模式 B 为 undefined */
  targetPos?: number;
  /** 填充区间 [start,end] 0..1 与颜色 */
  fillStart: number;
  fillEnd: number;
  fillSide: FillSide;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * 计算折叠行进度条几何。
 * @param entry 均价(成本)
 * @param current 现价(取最优买价,无则 curPrice)
 * @param n 目标倍数(每仓独立),用于模式 A 的目标价
 */
export function progressBar(entry: number, current: number, n: number): ProgressBar {
  const safeEntry = Number.isFinite(entry) && entry > 0 ? entry : 0;
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : 0;

  // 亏损比例(正数表示亏);entry 非法时按 0 处理。
  const lossFrac = safeEntry > 0 ? (safeEntry - safeCurrent) / safeEntry : 0;

  // ── 模式 B:深亏 > 15% ───────────────────
  if (safeEntry > 0 && lossFrac > LOSS_SWITCH) {
    const currentPos = clamp01(safeCurrent / safeEntry);
    return {
      mode: 'loss',
      entry: safeEntry,
      current: safeCurrent,
      entryPos: 1, // 平仓(右端)
      currentPos,
      fillStart: currentPos,
      fillEnd: 1,
      fillSide: 'down',
    };
  }

  // ── 模式 A:盈利 / 浅亏 ──────────────────
  const rawTarget = safeEntry > 0 ? safeEntry * n : 0;
  const reachable = rawTarget <= PRICE_MAX;
  const target = Math.min(rawTarget, PRICE_MAX);
  // 目标必须严格大于入场才有进度区间;n<=1 或退化时给极小正跨度避免除零。
  const span = target - safeEntry > 1e-9 ? target - safeEntry : 1e-9;
  const lossSpan = safeEntry > 0 ? safeEntry * LOSS_SWITCH : 1e-9;

  // 把 [entry,target]→[15%,70%] 的斜率外推到右端(100%)对应的价格。
  // 若该价 ≤ $1:正常锚定(target 钉 70%,右 30% 为超额余量)。
  // 若 > $1(target 太接近上限):改「封盘锚定」——右端固定 100¢(PRICE_MAX),
  //   entry→$1 线性铺满 [15%,100%],黄线按真实比例右移。两种模型在边界处恰好 70% 连续。
  const extrapRightEnd = safeEntry + (1 - ENTRY_POS) * (span / (TARGET_POS - ENTRY_POS));
  const settleAnchored = extrapRightEnd > PRICE_MAX;
  const settleSpan = PRICE_MAX - safeEntry > 1e-9 ? PRICE_MAX - safeEntry : 1e-9;

  // 盈利段斜率:正常用 [15%,70%]/span;封盘用 [15%,100%]/settleSpan。浅亏段两者一致。
  const pos = (price: number): number => {
    if (price < safeEntry) {
      return ENTRY_POS - ((safeEntry - price) / lossSpan) * ENTRY_POS;
    }
    return settleAnchored
      ? ENTRY_POS + ((price - safeEntry) / settleSpan) * (1 - ENTRY_POS)
      : ENTRY_POS + ((price - safeEntry) / span) * (TARGET_POS - ENTRY_POS);
  };

  const entryPos = ENTRY_POS;
  const targetPos = settleAnchored
    ? ENTRY_POS + ((target - safeEntry) / settleSpan) * (1 - ENTRY_POS)
    : TARGET_POS;
  const currentPos = clamp01(pos(safeCurrent));
  const isLoss = safeCurrent < safeEntry;

  return {
    mode: 'profit',
    entry: safeEntry,
    current: safeCurrent,
    target,
    reachable,
    entryPos,
    currentPos,
    targetPos,
    // 盈利:从入场(15%)填到现价;浅亏:从现价填回入场(绿)。
    fillStart: isLoss ? currentPos : entryPos,
    fillEnd: isLoss ? entryPos : currentPos,
    fillSide: isLoss ? 'down' : 'up',
  };
}
