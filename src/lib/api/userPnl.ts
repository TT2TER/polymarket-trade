/*
 * 组合层 P&L 序列(用于汇总条「今日 = 滚动 24h P/L」)。
 * 端点返回 [{t: unix秒, p: 该时刻累计盯市盈亏}, …];
 * 今日 ≈ p[末] − p[首](滚动 24 小时变化),与 WS 行情热路径解耦,低频拉取。
 */

const USER_PNL_URL = 'https://user-pnl-api.polymarket.com/user-pnl';

interface PnlPoint {
  t: number;
  p: number;
}

/** 返回滚动 24h 盈亏(美元);失败或数据不足返回 null。 */
export async function getTodayPnl(address: string): Promise<number | null> {
  if (!address) {
    return null;
  }

  const url = new URL(USER_PNL_URL);
  url.searchParams.set('user_address', address);
  url.searchParams.set('interval', '1d');
  url.searchParams.set('fidelity', '1h');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`User PnL request failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.length < 2) {
    return null;
  }

  const points = data as PnlPoint[];
  const first = points[0]?.p;
  const last = points[points.length - 1]?.p;
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }

  return last - first;
}
