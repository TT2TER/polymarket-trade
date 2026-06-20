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
  // 本笔实际 USDC 金额(优先于 size×price:更贴近链上真实结算额,成本/已实现盈亏用它更准)。
  usdcSize: number;
  outcome: string;
  title: string;
  slug: string;
  eventSlug: string;
  timestamp: number; // unix 秒
  transactionHash: string;
  // 本笔用户是否为 taker(吃单)。data-api 默认只返回 taker,故「同时出现在 takerOnly=true 结果」者为 taker。
  // 仅 taker 的 BUY 收手续费(SELL 豁免、maker 免),用于 #2 已实现盈亏的成本基校正。
  isTaker: boolean;
}

// 赎回事件(持有到市场结算,按 $1/$0 兑付)。/trades 不含,需从 /activity 取。
// 已实现盈亏必须纳入它,否则"买了没卖、结算输掉"的仓位亏损会被漏算(平均成本法只认卖出)。
export interface Redeem {
  conditionId: string;
  usdcSize: number; // 赎回所得(赢=份额×$1,输≈$0)
  title: string;
  timestamp: number;
  transactionHash: string;
}

export interface Activity {
  trades: Trade[];
  redeems: Redeem[];
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
    // /activity 提供 usdcSize(真实金额);/trades 无此字段时回退 size×price。
    usdcSize: Number.isFinite(num(raw.usdcSize)) && num(raw.usdcSize) > 0 ? num(raw.usdcSize) : size * num(raw.price),
    outcome: typeof raw.outcome === 'string' ? raw.outcome : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    slug: typeof raw.slug === 'string' ? raw.slug : '',
    eventSlug: typeof raw.eventSlug === 'string' ? raw.eventSlug : '',
    timestamp: num(raw.timestamp),
    transactionHash: typeof raw.transactionHash === 'string' ? raw.transactionHash : '',
    isTaker: false,
  };
}

// 成交身份键(用于把 takerOnly=true 子集标记回完整列表)。
function tradeKey(t: Trade): string {
  return `${t.transactionHash}|${t.asset}|${t.side}|${t.size}|${t.price}`;
}

async function fetchTrades(address: string, limit: number, takerOnly: boolean): Promise<Trade[]> {
  const url = new URL(TRADES_URL);
  url.searchParams.set('user', address);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('takerOnly', takerOnly ? 'true' : 'false');

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

const ACTIVITY_URL = 'https://data-api.polymarket.com/activity';

function normalizeRedeem(raw: Record<string, unknown>): Redeem | null {
  const conditionId = typeof raw.conditionId === 'string' ? raw.conditionId : '';
  if (!conditionId) {
    return null;
  }
  return {
    conditionId,
    usdcSize: num(raw.usdcSize),
    title: typeof raw.title === 'string' ? raw.title : '',
    timestamp: num(raw.timestamp),
    transactionHash: typeof raw.transactionHash === 'string' ? raw.transactionHash : '',
  };
}

// /activity 含全部事件类型(TRADE / REDEEM / SPLIT / MERGE …);这里取 TRADE 与 REDEEM。
// TRADE 与 /trades?takerOnly=false 同集合(maker+taker 全量)。
async function fetchActivity(address: string, limit: number): Promise<{ trades: Trade[]; redeems: Redeem[] }> {
  const url = new URL(ACTIVITY_URL);
  url.searchParams.set('user', address);
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString());
  if (response.status === 404) {
    return { trades: [], redeems: [] };
  }
  if (!response.ok) {
    throw new Error(`Activity request failed: ${response.status} ${response.statusText}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Activity response was not an array');
  }
  const trades: Trade[] = [];
  const redeems: Redeem[] = [];
  for (const item of data as Record<string, unknown>[]) {
    if (item.type === 'TRADE') {
      const trade = normalizeTrade(item);
      if (trade) {
        trades.push(trade);
      }
    } else if (item.type === 'REDEEM') {
      const redeem = normalizeRedeem(item);
      if (redeem) {
        redeems.push(redeem);
      }
    }
  }
  return { trades, redeems };
}

/**
 * 拉取某地址的完整活动(成交 + 赎回),并标记每笔成交 isTaker(默认最近 500 笔)。
 * /activity 取全量成交+赎回;/trades?takerOnly=true 取 taker 子集用于标记身份(失败则全按 maker,买入费按 0)。
 */
export async function getActivity(address: string, limit = 500): Promise<Activity> {
  const [activitySettled, takerSettled] = await Promise.allSettled([
    fetchActivity(address, limit),
    fetchTrades(address, limit, true),
  ]);
  if (activitySettled.status === 'rejected') {
    throw activitySettled.reason instanceof Error ? activitySettled.reason : new Error(String(activitySettled.reason));
  }
  const { trades, redeems } = activitySettled.value;
  if (takerSettled.status === 'fulfilled') {
    const takerKeys = new Set(takerSettled.value.map(tradeKey));
    for (const trade of trades) {
      trade.isTaker = takerKeys.has(tradeKey(trade));
    }
  }
  return { trades, redeems };
}
