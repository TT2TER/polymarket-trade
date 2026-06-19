// #4 封盘倒计时:把 Position.endDate(ISO 字符串)算成「距结算剩余时间」。
// 纯函数,不依赖 DOM / i18n,便于离线自测。展示文案(「结算中」等)由组件按语言补。
//
// ⚠ 命名:这是「时间倒计时」,与已有的「封盘 N×」价格倍率(=1/均价)无关,勿混淆。

export type SettlementUrgency = 'normal' | 'soon' | 'imminent' | 'closed';

export interface SettlementCountdown {
  /** 距结算剩余毫秒(已结算为 0)。 */
  remainingMs: number;
  /** 紧迫度:>24h normal / ≤24h soon / ≤2h imminent / ≤0 closed。 */
  urgency: SettlementUrgency;
  /** 语言无关的紧凑时长标签(如 "5d" / "1d3h" / "6h" / "12m");closed 时为空串。 */
  label: string;
  /** 超出展示窗口(默认 30 天):太远的市场不必在行内常驻 chip。 */
  farFuture: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SOON_MS = 24 * HOUR_MS; // ≤24h:黄
const IMMINENT_MS = 2 * HOUR_MS; // ≤2h:红
const FAR_FUTURE_MS = 30 * DAY_MS;

function formatLabel(remainingMs: number): string {
  if (remainingMs <= 0) {
    return '';
  }
  const totalMin = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMin / (24 * 60));
  const hours = Math.floor((totalMin % (24 * 60)) / 60);
  const mins = totalMin % 60;

  if (days >= 1) {
    // <2 天时带上小时,给临近结算更细的读数;更远只显示天。
    return days < 2 && hours > 0 ? `${days}d${hours}h` : `${days}d`;
  }
  if (hours >= 1) {
    // <2 小时(此时多为 imminent)带上分钟。
    return hours < 2 && mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  }
  return `${Math.max(1, mins)}m`;
}

/**
 * 解析 endDate 得到倒计时。endDate 缺失/非法/无法解析时返回 null(调用方不渲染 chip)。
 */
export function settlementCountdown(endDate: string | undefined | null, now: number = Date.now()): SettlementCountdown | null {
  if (!endDate) {
    return null;
  }
  const end = Date.parse(endDate);
  if (!Number.isFinite(end)) {
    return null;
  }

  const remainingMs = end - now;
  if (remainingMs <= 0) {
    return { remainingMs: 0, urgency: 'closed', label: '', farFuture: false };
  }

  const urgency: SettlementUrgency =
    remainingMs <= IMMINENT_MS ? 'imminent' : remainingMs <= SOON_MS ? 'soon' : 'normal';

  return {
    remainingMs,
    urgency,
    label: formatLabel(remainingMs),
    farFuture: remainingMs > FAR_FUTURE_MS,
  };
}
