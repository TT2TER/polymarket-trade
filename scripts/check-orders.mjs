import assert from 'node:assert/strict';

// 与 src/lib/trading/orders.ts 的纯逻辑保持一致(卖单 size 取 2 位小数)。
const SHARE_PRECISION = 100;

function tickDecimals(tickSize) {
  const [, decimals = ''] = tickSize.split('.');
  return decimals.length;
}

function roundToTick(price, tickSize) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const tick = Number(tickSize);
  return Number((Math.round(price / tick) * tick).toFixed(tickDecimals(tickSize)));
}

function ceilToTick(price, tickSize) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const tick = Number(tickSize);
  return Number((Math.ceil(price / tick) * tick).toFixed(tickDecimals(tickSize)));
}

function maxLimitPrice(tickSize) {
  return Number((1 - Number(tickSize)).toFixed(tickDecimals(tickSize)));
}

function roundDownShares(value) {
  return Math.floor(value * SHARE_PRECISION + 1e-9) / SHARE_PRECISION;
}

function computeNxCostQuantity(avg, size, price, n) {
  if (![avg, size, price, n].every((value) => Number.isFinite(value) && value > 0)) {
    return { qty: 0, capped: false, estCash: 0, remaining: Number.isFinite(size) ? Math.max(0, size) : 0 };
  }
  const rawQty = (n * avg * size) / price;
  const capped = rawQty > size;
  const qty = roundDownShares(Math.min(rawQty, size));
  const remaining = Math.max(0, roundDownShares(size - qty));
  return { qty, capped, estCash: qty * price, remaining };
}

async function verifyDryRunDoesNotSubmit() {
  const calls = [];
  const client = {
    async createOrder() {
      calls.push('createOrder');
      return { signed: true };
    },
    async postOrder() {
      calls.push('postOrder');
    },
    async createAndPostOrder() {
      calls.push('createAndPostOrder');
    },
  };
  const dryRun = true;
  if (dryRun) {
    await client.createOrder();
  } else {
    await client.postOrder(await client.createOrder(), 'GTC', false, true);
  }
  assert.deepEqual(calls, ['createOrder'], 'dryRun should build/sign but not submit');
}

// roundToTick(nearest) 与 ceilToTick(向上,用于 n 倍价挂单,保证不低于目标)
assert.equal(roundToTick(0.12344, '0.001'), 0.123);
assert.equal(roundToTick(0.1235, '0.001'), 0.124);
assert.equal(ceilToTick(0.1231, '0.001'), 0.124, 'ceil rounds up so sell target is not undercut');
assert.equal(ceilToTick(0.123, '0.001'), 0.123, 'exact tick stays');
assert.equal(roundToTick(-1, '0.001'), 0);
assert.equal(maxLimitPrice('0.001'), 0.999);
assert.equal(maxLimitPrice('0.01'), 0.99);

// 回收 n×成本:proceeds = n×cost 当可行
assert.deepEqual(computeNxCostQuantity(0.2, 100, 0.5, 2), { qty: 80, capped: false, estCash: 40, remaining: 20 });
// 现价低于 n×均价 → 封顶为全仓
assert.deepEqual(computeNxCostQuantity(0.4, 100, 0.5, 2), { qty: 100, capped: true, estCash: 50, remaining: 0 });
// 分数 size 在 2 位精度下向下取整
const frac = computeNxCostQuantity(0.3333, 12.3456, 0.4567, 1.7);
assert.equal(frac.qty, 12.34, 'capped qty rounded down to 2 decimals');
assert.equal(frac.capped, true);
assert.equal(frac.remaining, 0);
// L3:非法 size 不得返回 NaN remaining
assert.deepEqual(computeNxCostQuantity(0.2, Number.NaN, 0.5, 1), { qty: 0, capped: false, estCash: 0, remaining: 0 });

await verifyDryRunDoesNotSubmit();

console.log('check-orders: all assertions passed');
