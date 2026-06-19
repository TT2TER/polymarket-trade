// #4 市场时间提示:体育单场显示「开赛倒计时」(gameStartTime),开赛后显示「进行中」;
// 聚合市场显示「结算倒计时」(endDate)。gamma 无「比赛结束/真正封盘」字段,故体育市场不强行
// 预估结束时间——开赛才是流动性骤变、容易被套的关键时点,开赛后老实显示「进行中」而非假「结算中」。
//
// ⚠ 命名:与「封盘 N×」价格倍率(=1/均价)无关。

export type MarketTimerKind = 'kickoff' | 'live' | 'settle' | 'closed';
export type TimerUrgency = 'normal' | 'soon' | 'imminent';

export interface MarketTimer {
  kind: MarketTimerKind;
  /** kickoff/settle:剩余时长紧凑标签;live/closed 为空串。 */
  label: string;
  /** kickoff/settle 的紧迫度;live/closed 用 'normal'。 */
  urgency: TimerUrgency;
  /** settle 超出展示窗口(默认 30 天):太远不必常驻 chip。 */
  farFuture: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SOON_MS = 24 * HOUR_MS;
const IMMINENT_MS = 2 * HOUR_MS;
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
    return days < 2 && hours > 0 ? `${days}d${hours}h` : `${days}d`;
  }
  if (hours >= 1) {
    return hours < 2 && mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  }
  return `${Math.max(1, mins)}m`;
}

function urgencyOf(remainingMs: number): TimerUrgency {
  return remainingMs <= IMMINENT_MS ? 'imminent' : remainingMs <= SOON_MS ? 'soon' : 'normal';
}

function parse(iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 由市场元数据(开赛时间 / 结算时间)算时间提示。
 * 体育市场:开赛前 kickoff 倒计时;开赛后 live(进行中,结束时间未知不预估)。
 * 聚合市场:settle 结算倒计时;已过结算目标为 closed。
 * 两者都没有 → null(不渲染)。
 */
export function marketTimer(
  kickoffIso: string | null | undefined,
  settleIso: string | null | undefined,
  now: number = Date.now(),
): MarketTimer | null {
  const kickoff = parse(kickoffIso);
  if (kickoff !== null) {
    const remaining = kickoff - now;
    if (remaining > 0) {
      return { kind: 'kickoff', label: formatLabel(remaining), urgency: urgencyOf(remaining), farFuture: remaining > FAR_FUTURE_MS };
    }
    // 已开赛:比赛进行中,结束/结算时间未知,不预估。
    return { kind: 'live', label: '', urgency: 'normal', farFuture: false };
  }

  const settle = parse(settleIso);
  if (settle !== null) {
    const remaining = settle - now;
    if (remaining > 0) {
      return { kind: 'settle', label: formatLabel(remaining), urgency: urgencyOf(remaining), farFuture: remaining > FAR_FUTURE_MS };
    }
    return { kind: 'closed', label: '', urgency: 'normal', farFuture: false };
  }

  return null;
}
