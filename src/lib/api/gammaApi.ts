// #4 封盘倒计时的正确数据源:data-api 的 positions 只给纯日期 endDate(如 "2026-06-19",无时分,
// 且常是「预计结算日」而非停盘时间),不可用作封盘倒计时。改从 gamma 市场元数据取:
//   封盘时间 = gameStartTime(单场比赛,开赛即停盘) || endDate(聚合市场的结算目标,完整 ISO)。
// 低频拉取(持仓的 conditionId 集合变化时拉一次),与高频行情 WS 解耦。

const GAMMA_MARKETS_URL = 'https://gamma-api.polymarket.com/markets';
const CHUNK = 20; // 每次请求的 condition_ids 数量,避免 URL 过长。

export interface MarketMeta {
  /** 封盘时间,规范化为 ISO 字符串;取不到为 null。 */
  closeTime: string | null;
}

// gamma 的 gameStartTime 形如 "2026-06-19 22:00:00+00"(空格分隔、偏移无冒号),
// endDate 形如 "2026-06-19T22:00:00Z"(标准 ISO)。统一规范化到可被 Date.parse 稳定解析的 ISO。
function normalizeIso(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  let value = raw.trim().replace(' ', 'T');
  // 补全无冒号的时区偏移:"…22:00:00+00" → "+00:00";"…+0000" → "+00:00"。
  // 锚定在 HH:MM:SS 之后,避免误伤纯日期里的 "-19" 这类「日」分量。
  value = value.replace(
    /(\d{2}:\d{2}:\d{2})([+-]\d{2})(\d{2})?$/,
    (_, time: string, hh: string, mm?: string) => `${time}${hh}:${mm ?? '00'}`,
  );
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

interface GammaMarket {
  conditionId?: string;
  gameStartTime?: string;
  endDate?: string;
}

/**
 * 按 conditionId 批量取市场元数据,返回 conditionId → { closeTime }。
 * 某个 id 查不到 / 解析失败时,该 id 不出现在结果里(调用方按缺省处理)。
 */
export async function getMarketMeta(conditionIds: string[]): Promise<Record<string, MarketMeta>> {
  const unique = Array.from(new Set(conditionIds.filter((id) => typeof id === 'string' && id.length > 0)));
  const result: Record<string, MarketMeta> = {};

  for (const ids of chunk(unique, CHUNK)) {
    const url = new URL(GAMMA_MARKETS_URL);
    for (const id of ids) {
      url.searchParams.append('condition_ids', id);
    }
    url.searchParams.set('limit', String(ids.length));

    const response = await fetch(url.toString());
    if (!response.ok) {
      // 抛错让调用方把这批 conditionId 移出「已请求」集合以便重试(否则会被误当成功而永不重拉)。
      throw new Error(`Gamma markets request failed: ${response.status} ${response.statusText}`);
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      continue;
    }
    for (const market of data as GammaMarket[]) {
      const id = market.conditionId;
      if (!id) {
        continue;
      }
      result[id] = { closeTime: normalizeIso(market.gameStartTime) ?? normalizeIso(market.endDate) };
    }
  }

  return result;
}
