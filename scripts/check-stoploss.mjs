import assert from 'node:assert/strict';

const DEFAULT_WINDOW_MS = 30_000;
const DEFAULT_COOLDOWN_MS = 60_000;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function createState() {
  return {
    window: { prices: [] },
    cooldownUntil: 0,
    waitingForRearm: false,
  };
}

function pruneWindow(window, now, windowMs) {
  const cutoff = now - windowMs;
  while (window.prices.length > 0 && window.prices[0].timestamp < cutoff) {
    window.prices.shift();
  }
}

function pushPrice(window, timestamp, price) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) return;
  const last = window.prices[window.prices.length - 1];
  if (last && timestamp < last.timestamp) return; // 强制单调(M2)
  window.prices.push({ timestamp, price });
}

function maxInWindow(window, now, windowMs) {
  pruneWindow(window, now, windowMs);
  return window.prices.reduce((maxPrice, point) => Math.max(maxPrice, point.price), 0);
}

function currentDrop(window, now, windowMs, priceNow) {
  if (!Number.isFinite(priceNow) || priceNow <= 0) return 0;
  const maxPrice = maxInWindow(window, now, windowMs);
  return maxPrice > 0 ? Math.max(0, (maxPrice - priceNow) / maxPrice) : 0;
}

function autoThreshold(priceNow) {
  return clamp(0.05 + 0.1 * (1 - priceNow), 0.04, 0.15);
}

function autoSellFraction(drop, threshold, value) {
  const severity = clamp(drop / threshold, 1, 2.5);
  const sizeFactor = clamp(value / 300, 0.7, 1.5);
  return clamp(0.4 * severity * sizeFactor, 0.25, 1);
}

function evaluate(state, priceNow, now, params = {}) {
  const windowMs = params.windowMs ?? DEFAULT_WINDOW_MS;
  const cooldownMs = params.cooldownMs ?? DEFAULT_COOLDOWN_MS;
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
  state.window.prices = [{ timestamp: now, price: priceNow }]; // 触发后重置窗口(M1)
  return { triggered: true, drop, threshold, sellFraction };
}

assert.equal(autoThreshold(0.9), 0.06, 'high-price threshold follows formula');
assert.equal(autoThreshold(0.2), 0.13, 'low-price threshold is larger');
assert.equal(autoThreshold(1.5), 0.04, 'threshold lower bound clamps');
assert.equal(autoThreshold(-1), 0.15, 'threshold upper bound clamps');

assert.equal(autoSellFraction(0.1, 0.1, 300), 0.4, 'base sell fraction at severity 1 and value 300');
assert.equal(autoSellFraction(0.25, 0.1, 450), 1, 'severe drop and large position clamp to full sell');
assert.equal(autoSellFraction(0.1, 0.1, 30), 0.27999999999999997, 'small position uses lower size factor');

const window = { prices: [] };
pushPrice(window, 0, 0.8);
pushPrice(window, 10_000, 0.7);
pushPrice(window, 20_000, 0.6);
assert.equal(maxInWindow(window, 20_000, DEFAULT_WINDOW_MS), 0.8);
assert.equal(currentDrop(window, 20_000, DEFAULT_WINDOW_MS, 0.6), 0.25000000000000006);
pushPrice(window, 40_001, 0.6);
assert.equal(maxInWindow(window, 40_001, DEFAULT_WINDOW_MS), 0.6, 'old highs fall out of rolling window');
assert.equal(currentDrop(window, 40_001, DEFAULT_WINDOW_MS, 0.6), 0);

const state = createState();
assert.equal(evaluate(state, 0.8, 0, { threshold: 0.1, windowMs: 300_000 }).triggered, false);
const firstTrigger = evaluate(state, 0.7, 1_000, { threshold: 0.1, windowMs: 300_000 });
assert.equal(firstTrigger.triggered, true, 'drop over threshold triggers');
assert.equal(state.cooldownUntil, 61_000);
assert.equal(evaluate(state, 0.69, 2_000, { threshold: 0.1, windowMs: 300_000 }).triggered, false, 'cooldown suppresses repeat');
assert.equal(evaluate(state, 0.69, 62_000, { threshold: 0.1, windowMs: 300_000 }).triggered, false, 'still over threshold waits for rearm');
assert.equal(evaluate(state, 0.75, 63_000, { threshold: 0.1, windowMs: 300_000 }).triggered, false, 'stable price rearms');
assert.equal(evaluate(state, 0.65, 64_000, { threshold: 0.1, windowMs: 300_000 }).triggered, true, 'rearmed detector can trigger again');

// M1:触发后窗口被重置,跌幅从触发价重新度量(避免同一次崩盘反复触发)
const m1 = createState();
evaluate(m1, 0.8, 0, { threshold: 0.1, windowMs: 300_000 });
const m1Trigger = evaluate(m1, 0.7, 1_000, { threshold: 0.1, windowMs: 300_000 });
assert.equal(m1Trigger.triggered, true);
assert.deepEqual(m1.window.prices, [{ timestamp: 1_000, price: 0.7 }], 'window reset to trigger sample');

// M2:乱序/回拨时间戳的样本被丢弃,不污染窗口最大值
const m2 = { prices: [] };
pushPrice(m2, 10_000, 0.6);
pushPrice(m2, 5_000, 0.9); // 旧时间戳,应被忽略
assert.deepEqual(m2.prices, [{ timestamp: 10_000, price: 0.6 }], 'out-of-order sample ignored');

console.log('check-stoploss: all assertions passed');
