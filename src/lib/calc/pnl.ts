export function breakEven(avgPrice: number): number {
  return avgPrice;
}

export function multiplePrice(avgPrice: number, n: number): { price: number; reachable: boolean } {
  const rawPrice = avgPrice * n;
  const reachable = rawPrice <= 0.999;
  return {
    price: Math.min(rawPrice, 0.999),
    reachable,
  };
}

export function unrealizedPnl(
  size: number,
  avgPrice: number,
  currentPrice: number,
): { absolute: number; percent: number } {
  const absolute = (currentPrice - avgPrice) * size;
  const cost = avgPrice * size;
  const percent = cost > 0 ? (absolute / cost) * 100 : 0;

  return { absolute, percent };
}

export function impliedProb(price: number): number {
  return price;
}
