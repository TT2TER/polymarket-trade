export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface RollingPriceWindow {
  prices: PricePoint[];
}

export interface StopLossDetectorState {
  window: RollingPriceWindow;
  cooldownUntil: number;
  waitingForRearm: boolean;
}

export interface StopLossEvaluateParams {
  windowMs?: number;
  threshold?: number;
  sellFraction?: number;
  value?: number;
  cooldownMs?: number;
}

export interface StopLossEvaluation {
  triggered: boolean;
  drop: number;
  threshold: number;
  sellFraction: number;
}

export const DEFAULT_STOP_LOSS_WINDOW_MS = 30_000;
export const DEFAULT_STOP_LOSS_COOLDOWN_MS = 60_000;

export function createStopLossDetectorState(): StopLossDetectorState {
  return {
    window: { prices: [] },
    cooldownUntil: 0,
    waitingForRearm: false,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function pruneWindow(window: RollingPriceWindow, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  while (window.prices.length > 0 && window.prices[0].timestamp < cutoff) {
    window.prices.shift();
  }
}

export function pushPrice(window: RollingPriceWindow, timestamp: number, price: number): void {
  if (!Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) {
    return;
  }

  // 强制时间戳单调:丢弃乱序/时钟回拨的样本,避免按数组头剪枝时残留历史高价导致误触发(M2)。
  const last = window.prices[window.prices.length - 1];
  if (last && timestamp < last.timestamp) {
    return;
  }

  window.prices.push({ timestamp, price });
}

export function maxInWindow(window: RollingPriceWindow, now: number, windowMs: number): number {
  pruneWindow(window, now, windowMs);
  let maxPrice = 0;

  for (const point of window.prices) {
    if (point.price > maxPrice) {
      maxPrice = point.price;
    }
  }

  return maxPrice;
}

export function currentDrop(window: RollingPriceWindow, now: number, windowMs: number, priceNow: number): number {
  if (!Number.isFinite(priceNow) || priceNow <= 0) {
    return 0;
  }

  const maxPrice = maxInWindow(window, now, windowMs);
  if (maxPrice <= 0) {
    return 0;
  }

  return Math.max(0, (maxPrice - priceNow) / maxPrice);
}

export function autoThreshold(priceNow: number): number {
  return clamp(0.05 + 0.1 * (1 - priceNow), 0.04, 0.15);
}

export function autoSellFraction(drop: number, threshold: number, value: number): number {
  const severity = clamp(drop / threshold, 1, 2.5);
  const sizeFactor = clamp(value / 300, 0.7, 1.5);
  return clamp(0.4 * severity * sizeFactor, 0.25, 1);
}

export function evaluate(
  state: StopLossDetectorState,
  priceNow: number,
  now: number,
  params: StopLossEvaluateParams = {},
): StopLossEvaluation {
  const windowMs = params.windowMs ?? DEFAULT_STOP_LOSS_WINDOW_MS;
  const cooldownMs = params.cooldownMs ?? DEFAULT_STOP_LOSS_COOLDOWN_MS;
  pushPrice(state.window, now, priceNow);

  const threshold = params.threshold ?? autoThreshold(priceNow);
  const drop = currentDrop(state.window, now, windowMs, priceNow);
  const sellFraction = params.sellFraction ?? autoSellFraction(drop, threshold, params.value ?? 0);
  const overThreshold = drop >= threshold;

  if (state.waitingForRearm && now >= state.cooldownUntil && !overThreshold) {
    state.waitingForRearm = false;
  }

  if (now < state.cooldownUntil || state.waitingForRearm || !overThreshold) {
    return { triggered: false, drop, threshold, sellFraction };
  }

  state.cooldownUntil = now + cooldownMs;
  state.waitingForRearm = true;
  // 触发后清空窗口:之后的跌幅从新的高点重新度量,避免同一次崩盘在冷却结束后被反复触发(M1)。
  state.window.prices = [{ timestamp: now, price: priceNow }];
  return { triggered: true, drop, threshold, sellFraction };
}
