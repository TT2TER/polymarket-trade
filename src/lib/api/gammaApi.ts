// #4 封盘倒计时的正确数据源:data-api 的 positions 只给纯日期 endDate(如 "2026-06-19",无时分,
// 且常是「预计结算日」而非停盘时间),不可用作封盘倒计时。改从 gamma 市场元数据取:
//   封盘时间 = gameStartTime(单场比赛,开赛即停盘) || endDate(聚合市场的结算目标,完整 ISO)。
// 低频拉取(持仓的 conditionId 集合变化时拉一次),与高频行情 WS 解耦。

const GAMMA_MARKETS_URL = 'https://gamma-api.polymarket.com/markets';
const CHUNK = 20; // 每次请求的 condition_ids 数量,避免 URL 过长。

// 每个市场官方的 taker 费率表(gamma 直接暴露,权威、按市场,自动适配品类与未来调价)。
export interface MarketFee {
  // taker 费率系数。fee = rate × 数量 × 价 × (价×(1−价))^exponent。
  rate: number;
  exponent: number;
  // feesEnabled 为假则该市场不收费。
  enabled: boolean;
}

export interface MarketMeta {
  // 开赛时间(体育单场:gameStartTime)。这是流动性骤变的关键时点,但 ≠ 比赛结束/真正封盘
  //(gamma 无比赛结束字段;实测体育市场 endDate==gameStartTime==开赛,开赛后仍 acceptingOrders)。
  kickoff: string | null;
  // 结算目标时间(聚合市场:endDate,完整 ISO)。仅在「无 gameStartTime」时有意义;
  // 体育单场的 endDate 不可信(=开赛),故此时置 null。
  settleTime: string | null;
  // 官方 taker 费率表;取不到为 null(不校正手续费)。
  fee: MarketFee | null;
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
  feesEnabled?: boolean;
  feeSchedule?: { rate?: number; exponent?: number };
}

function parseFee(market: GammaMarket): MarketFee | null {
  const schedule = market.feeSchedule;
  if (!schedule || typeof schedule.rate !== 'number' || !Number.isFinite(schedule.rate)) {
    return null;
  }
  const exponent = typeof schedule.exponent === 'number' && Number.isFinite(schedule.exponent) ? schedule.exponent : 1;
  return { rate: schedule.rate, exponent, enabled: market.feesEnabled !== false };
}

// 取一批 conditionId 的市场。closed=undefined → 默认只返回未结算市场;closed='true' → 只返回已结算。
// gamma 默认排除已结算市场,而历史成交多在已结算市场上,故需两次(open + closed)合并。
async function fetchMarketsChunk(ids: string[], closed?: 'true'): Promise<GammaMarket[]> {
  const url = new URL(GAMMA_MARKETS_URL);
  for (const id of ids) {
    url.searchParams.append('condition_ids', id);
  }
  url.searchParams.set('limit', String(ids.length));
  if (closed) {
    url.searchParams.set('closed', closed);
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    // 抛错让调用方把这批 conditionId 移出「已请求」集合以便重试(否则会被误当成功而永不重拉)。
    throw new Error(`Gamma markets request failed: ${response.status} ${response.statusText}`);
  }
  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as GammaMarket[]) : [];
}

/**
 * 按 conditionId 批量取市场元数据(开赛/结算时间 + 官方费率表)。
 * 同时取未结算与已结算市场(历史成交多在已结算市场上)。某 id 查不到则不出现在结果里。
 */
export async function getMarketMeta(conditionIds: string[]): Promise<Record<string, MarketMeta>> {
  const unique = Array.from(new Set(conditionIds.filter((id) => typeof id === 'string' && id.length > 0)));
  const result: Record<string, MarketMeta> = {};

  for (const ids of chunk(unique, CHUNK)) {
    const [open, closedMarkets] = await Promise.all([fetchMarketsChunk(ids), fetchMarketsChunk(ids, 'true')]);
    for (const market of [...open, ...closedMarkets]) {
      const id = market.conditionId;
      if (!id) {
        continue;
      }
      const kickoff = normalizeIso(market.gameStartTime);
      // 体育单场(有 gameStartTime):endDate 不可信(=开赛),settleTime 置 null;
      // 聚合市场(无 gameStartTime):endDate 即结算目标。
      result[id] = {
        kickoff,
        settleTime: kickoff ? null : normalizeIso(market.endDate),
        fee: parseFee(market),
      };
    }
  }

  return result;
}
