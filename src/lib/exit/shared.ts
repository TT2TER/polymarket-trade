import { getBestBid } from '@/lib/api/clobApi';
import type { OrderBook } from '@/lib/types';

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function pushBid(recentBids: number[], bid: number, refK: number): void {
  if (!Number.isFinite(bid) || bid <= 0) {
    return;
  }

  const size = Math.max(1, Math.floor(refK));
  recentBids.push(bid);
  while (recentBids.length > size) {
    recentBids.shift();
  }
}

export function median(values: readonly number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }

  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function medianRef(recentBids: readonly number[]): number;
export function medianRef(book: OrderBook | null | undefined, recentBids: number[], refK: number): number;
export function medianRef(
  bookOrBids: OrderBook | readonly number[] | null | undefined,
  recentBids?: number[],
  refK?: number,
): number {
  if (Array.isArray(bookOrBids)) {
    return median(bookOrBids);
  }

  if (!recentBids || refK === undefined) {
    return 0;
  }

  const bid = getBestBid(bookOrBids as OrderBook | null | undefined);
  pushBid(recentBids, bid, refK);
  return median(recentBids);
}

export class DwellGate {
  breachStart = 0;

  feed(breach: boolean, now: number, dwellMs: number): boolean {
    if (!breach) {
      this.breachStart = 0;
      return false;
    }

    if (this.breachStart === 0) {
      this.breachStart = now;
    }

    return now - this.breachStart >= Math.max(0, dwellMs);
  }

  reset(): void {
    this.breachStart = 0;
  }
}
