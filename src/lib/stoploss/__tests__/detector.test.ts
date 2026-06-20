import { describe, expect, it } from 'vitest';
import { createStopLossDetectorState, evaluate } from '@/lib/stoploss/detector';
import { DEFAULT_STOP_LOSS_DEFAULTS, type ResolvedStopLossConfig } from '@/shared/stopLossConfig';

function cfg(overrides: Partial<ResolvedStopLossConfig> = {}): ResolvedStopLossConfig {
  return {
    ...DEFAULT_STOP_LOSS_DEFAULTS,
    armed: true,
    dwellMs: 0,
    ...overrides,
  };
}

function tick(
  state: ReturnType<typeof createStopLossDetectorState>,
  bid: number,
  now: number,
  cost: number,
  config = cfg(),
) {
  return evaluate(state, bid, now, { cost, config });
}

describe('stoploss detector redesign', () => {
  it('example 1: activates trailing, ignores a single-tick bid spike, then triggers on sustained true drop', () => {
    const state = createStopLossDetectorState();
    const config = cfg({ dwellMs: 1_000 });

    const first = tick(state, 0.78, 1_000, 0.2, config);
    expect(first.activated).toBe(true);
    expect(first.regime).toBe('trailing');
    expect(first.exitLine).toBeCloseTo(0.78 * (1 - first.threshold), 6);
    expect(first.exitLine).toBeCloseTo(0.72384, 5);

    for (const [i, bid] of [0.76, 0.77, 0.62, 0.76, 0.77].entries()) {
      const result = tick(state, bid, 2_000 + i * 100, 0.2, config);
      expect(result.triggered).toBe(false);
    }
    expect(medianOf(state.recentBids)).toBeCloseTo(0.76, 6);

    for (const [i, bid] of [0.5, 0.5, 0.5].entries()) {
      const result = tick(state, bid, 3_000 + i * 100, 0.2, config);
      expect(result.triggered).toBe(false);
    }

    const breach = tick(state, 0.5, 4_000, 0.2, config);
    expect(breach.breach).toBe(true);
    expect(breach.triggered).toBe(false);

    const triggered = tick(state, 0.5, 5_000, 0.2, config);
    expect(triggered.triggered).toBe(true);
    expect(triggered.ref).toBe(0.5);
  });

  it('example 2: unactivated cost anchor exits at the max loss floor', () => {
    const state = createStopLossDetectorState();
    const config = cfg();

    const warm = tick(state, 0.21, 1_000, 0.2, config);
    expect(warm.activated).toBe(false);
    expect(warm.regime).toBe('loss-floor');
    expect(warm.exitLine).toBeCloseTo(0.15, 6);

    // 中位数平滑:单根 0.15 与前一根 0.21 取中位 = 0.18,尚未破地板;需多根才把 ref 拉到 0.15。
    const smoothed = tick(state, 0.15, 2_000, 0.2, config);
    expect(smoothed.ref).toBeCloseTo(0.18, 6);
    expect(smoothed.breach).toBe(false);

    const floor = tick(state, 0.15, 2_100, 0.2, config);
    expect(floor.ref).toBeCloseTo(0.15, 6);
    expect(floor.regime).toBe('loss-floor');
    expect(floor.breach).toBe(true);
    expect(floor.triggered).toBe(true);
  });

  it('example 3: low-price tail uses the absolute floor until it moons above the floor', () => {
    const state = createStopLossDetectorState();
    const config = cfg();

    for (const [i, bid] of [0.05, 0.08, 0.04, 0.06].entries()) {
      const result = tick(state, bid, 1_000 + i * 100, 0.05, config);
      expect(result.regime).toBe('lowprice');
      expect(result.exitLine).toBeCloseTo(0.025, 6);
      expect(result.triggered).toBe(false);
    }

    // 中位数平滑:单根 0.3 拉不动中位数(仍 ~0.06),需连续多根才让 ref 越过 lowPriceFloor 触发激活。
    let moon = tick(state, 0.3, 2_000, 0.05, config);
    for (let i = 1; i < 5; i += 1) {
      moon = tick(state, 0.3, 2_000 + i * 100, 0.05, config);
    }
    expect(moon.ref).toBeCloseTo(0.3, 6);
    expect(moon.activated).toBe(true);
    expect(moon.regime).toBe('trailing');
    expect(moon.exitLine).toBeGreaterThan(0.05);
  });

  it('example 4: activated trailing can bind to the breakeven floor and not cut normal chop above cost', () => {
    const state = createStopLossDetectorState();
    const config = cfg({ baseThreshold: 0.1 });

    const activated = tick(state, 0.25, 1_000, 0.2, config);
    expect(activated.activated).toBe(true);
    expect(activated.regime).toBe('breakeven');
    expect(activated.exitLine).toBeCloseTo(0.2, 6);

    for (const [i, bid] of [0.24, 0.22, 0.21, 0.2].entries()) {
      const result = tick(state, bid, 2_000 + i * 100, 0.2, config);
      expect(result.triggered).toBe(false);
    }

    tick(state, 0.19, 3_000, 0.2, config);
    tick(state, 0.19, 3_100, 0.2, config);
    const broken = tick(state, 0.19, 3_200, 0.2, config);
    expect(broken.breach).toBe(true);
    expect(broken.triggered).toBe(true);
  });
});

function medianOf(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}
