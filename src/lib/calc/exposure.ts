// #5 风险敞口总览:把持仓按 event 聚合,算出每个 event 占总持仓价值的比例(集中度)。
// 目的:防「隐性过度集中」——多个不同市场可能押在同一底层风险上(如同时买巴西夺冠 + 决赛巴西),
// 单仓视图看不出,聚合后一眼可见。价值口径与汇总条一致(用 data-api 的 currentValue)。

import type { Position } from '@/lib/types';

export interface EventExposure {
  eventId: string;
  label: string;
  value: number;
  /** 占总持仓价值比例 0~1。 */
  share: number;
  /** 是否为折叠出的「其他」合并行(用标志位而非比较 eventId 字符串,避免与真实 id 撞名)。 */
  isOther?: boolean;
}

function finiteShare(value: number, total: number): number {
  if (!(total > 0)) {
    return 0;
  }
  const share = value / total;
  return Number.isFinite(share) ? share : 0;
}

export interface ExposureSummary {
  rows: EventExposure[]; // 按价值降序
  total: number;
  /** 最高单一 event 占比(0~1);用于「过度集中」高亮。 */
  maxShare: number;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function computeExposure(positions: Position[]): ExposureSummary {
  const groups = new Map<string, EventExposure>();
  let total = 0;

  for (const position of positions) {
    if (position.redeemable) {
      continue; // 已结算仓不计入当前敞口。
    }
    const value = finite(position.currentValue);
    if (value <= 0) {
      continue;
    }
    total += value;

    const eventId = position.eventId || position.conditionId;
    const existing = groups.get(eventId);
    if (existing) {
      existing.value += value;
    } else {
      groups.set(eventId, {
        eventId,
        label: position.eventSlug || position.title || eventId,
        value,
        share: 0,
      });
    }
  }

  const rows = [...groups.values()].sort((a, b) => b.value - a.value);
  for (const row of rows) {
    row.share = finiteShare(row.value, total);
  }

  return { rows, total, maxShare: rows.length > 0 ? rows[0].share : 0 };
}

/**
 * 折叠:取前 maxRows 个 event,其余合并为一个「其他」行(传入 otherLabel)。
 * 单一 event 时返回空数组(集中度为 100% 无信息量,调用方可据此不渲染)。
 */
export function foldExposure(summary: ExposureSummary, maxRows: number, otherLabel: string): EventExposure[] {
  if (summary.rows.length <= 1) {
    return [];
  }
  if (summary.rows.length <= maxRows) {
    return summary.rows;
  }
  const head = summary.rows.slice(0, maxRows);
  const tail = summary.rows.slice(maxRows);
  const otherValue = tail.reduce((sum, row) => sum + row.value, 0);
  head.push({
    eventId: '__other__',
    label: otherLabel,
    value: otherValue,
    share: finiteShare(otherValue, summary.total),
    isOther: true,
  });
  return head;
}
