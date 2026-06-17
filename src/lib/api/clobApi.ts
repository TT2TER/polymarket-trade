import type { BookLevel, OrderBook } from '@/lib/types';

const CLOB_URL = 'https://clob.polymarket.com';

function parseNumeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// 仅保留价格为有限正数的档位:过滤掉解析失败(NaN→0)或 0 价的幽灵档,
// 否则排序会把 0 价排到最优位,导致最优买/卖价被错误地算成 0。
function validLevels(levels: BookLevel[]): BookLevel[] {
  return levels.filter((level) => {
    const price = Number(level.price);
    return Number.isFinite(price) && price > 0;
  });
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${label} request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export function sortBidsByBest(levels: BookLevel[]): BookLevel[] {
  return validLevels(levels).sort((a, b) => parseNumeric(b.price) - parseNumeric(a.price));
}

export function sortAsksByBest(levels: BookLevel[]): BookLevel[] {
  return validLevels(levels).sort((a, b) => parseNumeric(a.price) - parseNumeric(b.price));
}

export function getBestBid(book: OrderBook | null | undefined): number {
  const best = sortBidsByBest(book?.bids ?? [])[0];
  return best ? parseNumeric(best.price) : 0;
}

export function getBestAsk(book: OrderBook | null | undefined): number {
  const best = sortAsksByBest(book?.asks ?? [])[0];
  return best ? parseNumeric(best.price) : 0;
}

export async function getBook(tokenId: string): Promise<OrderBook> {
  const url = new URL(`${CLOB_URL}/book`);
  url.searchParams.set('token_id', tokenId);

  return readJson<OrderBook>(await fetch(url.toString()), 'Book');
}

export async function getBooks(tokenIds: string[]): Promise<OrderBook[]> {
  if (tokenIds.length === 0) {
    return [];
  }

  const response = await fetch(`${CLOB_URL}/books`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tokenIds.map((tokenId) => ({ token_id: tokenId }))),
  });

  const data = await readJson<unknown>(response, 'Books');
  if (!Array.isArray(data)) {
    throw new Error('Books response was not an array');
  }

  return data as OrderBook[];
}

export async function getPrice(tokenId: string, side: 'buy' | 'sell'): Promise<number> {
  const url = new URL(`${CLOB_URL}/price`);
  url.searchParams.set('token_id', tokenId);
  url.searchParams.set('side', side);

  const data = await readJson<{ price: string }>(await fetch(url.toString()), 'Price');
  return parseNumeric(data.price);
}

export async function getMidpoint(tokenId: string): Promise<number> {
  const url = new URL(`${CLOB_URL}/midpoint`);
  url.searchParams.set('token_id', tokenId);

  const data = await readJson<{ mid: string }>(await fetch(url.toString()), 'Midpoint');
  return parseNumeric(data.mid);
}
