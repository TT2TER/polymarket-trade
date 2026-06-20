import { describe, expect, it } from 'vitest';
import { DwellGate, medianRef, pushBid } from '@/lib/exit/shared';

describe('exit shared primitives', () => {
  it('keeps a rolling bid window and returns the median reference', () => {
    const bids: number[] = [];

    for (const bid of [0.76, 0.77, 0.62, 0.76, 0.77]) {
      pushBid(bids, bid, 5);
    }

    expect(medianRef(bids)).toBe(0.76);

    pushBid(bids, 0.78, 5);
    expect(bids).toEqual([0.77, 0.62, 0.76, 0.77, 0.78]);
    expect(medianRef(bids)).toBe(0.77);
  });

  it('requires a continuous breach for dwell confirmation', () => {
    const gate = new DwellGate();

    expect(gate.feed(true, 1_000, 2_000)).toBe(false);
    expect(gate.feed(false, 1_800, 2_000)).toBe(false);
    expect(gate.feed(true, 2_000, 2_000)).toBe(false);
    expect(gate.feed(true, 3_999, 2_000)).toBe(false);
    expect(gate.feed(true, 4_000, 2_000)).toBe(true);
  });
});
