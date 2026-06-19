// #2 成交历史的数据源:data-api 的公开 /trades?user=<proxy>(与 /positions 同族,只读无需认证)。
// 返回的是**真实成交**(逐笔 fill,含 txHash),天然满足「只记真实成交」——无需 record-at-submit 再对账,
// 也无需认证 user WS。代价:很长的历史需翻页;v1 取较大 limit,超长历史的早期成本基或被截断(见 realizedPnl)。

const TRADES_URL = 'https://data-api.polymarket.com/trades';

export interface Trade {
  asset: string;
  conditionId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  outcome: string;
  title: string;
  slug: string;
  eventSlug: string;
  timestamp: number; // unix 秒
  transactionHash: string;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// side 无法识别(脏数据)→ 返回 null 丢弃,绝不默认成 BUY 污染成本基;size≤0 同样丢弃。
function normalizeTrade(raw: Record<string, unknown>): Trade | null {
  if (raw.side !== 'BUY' && raw.side !== 'SELL') {
    return null;
  }
  const size = num(raw.size);
  if (!(size > 0)) {
    return null;
  }
  return {
    asset: typeof raw.asset === 'string' ? raw.asset : '',
    conditionId: typeof raw.conditionId === 'string' ? raw.conditionId : '',
    side: raw.side,
    size,
    price: num(raw.price),
    outcome: typeof raw.outcome === 'string' ? raw.outcome : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    slug: typeof raw.slug === 'string' ? raw.slug : '',
    eventSlug: typeof raw.eventSlug === 'string' ? raw.eventSlug : '',
    timestamp: num(raw.timestamp),
    transactionHash: typeof raw.transactionHash === 'string' ? raw.transactionHash : '',
  };
}

/** 拉取某地址的成交流水(默认最近 500 笔)。data-api 对无成交返回 404 → 空数组。 */
export async function getTrades(address: string, limit = 500): Promise<Trade[]> {
  const url = new URL(TRADES_URL);
  url.searchParams.set('user', address);
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString());
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Trades request failed: ${response.status} ${response.statusText}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Trades response was not an array');
  }
  return data
    .map((item) => normalizeTrade(item as Record<string, unknown>))
    .filter((trade): trade is Trade => trade !== null);
}
