import assert from 'node:assert/strict';
import { breakEven, impliedProb, multiplePrice, unrealizedPnl } from '../src/lib/calc/pnl';

assert.equal(breakEven(0.42), 0.42);

assert.deepEqual(multiplePrice(0.2, 3), { price: 0.6000000000000001, reachable: true });
assert.deepEqual(multiplePrice(0.6, 2), { price: 0.999, reachable: false });

assert.deepEqual(unrealizedPnl(100, 0.25, 0.4), {
  absolute: 15.000000000000002,
  percent: 60.00000000000001,
});

assert.equal(impliedProb(0.73), 0.73);

console.log('pnl checks passed');
