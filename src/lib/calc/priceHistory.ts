// #1 价格走势 sparkline 的数据层:每个 asset 维护一段内存级价格序列。
// 采样价 = getBestBid(book) || curPrice(与 PositionCard.currentPrice 一致,即「现在能卖到的价」)。
// 设计要点:
//  - 事件驱动:仅当该 asset 价格相对上一个采样点变化才追加(WS emit 由任一 asset 变动触发,
//    若每帧给所有 asset 都补点会让窗口被他人噪声填满)。
//  - 无变化返回同一引用(数组与顶层 map 都是),避免 store 订阅方无谓重渲染。
//  - 关面板即清(内存级,固定短窗口);不持久化(见 progress.md P7 #1 决策)。

import { getBestBid } from '@/lib/api/clobApi';
import type { Snapshot } from '@/lib/datasource/types';

export type PriceHistory = Record<string, number[]>;

/** 每个 asset 保留的最大采样点数(短窗口)。 */
export const MAX_HISTORY_POINTS = 120;

function liveSellPrice(snapshot: Snapshot, asset: string, curPrice: number): number {
  const bid = getBestBid(snapshot.books[asset]);
  return bid > 0 ? bid : curPrice;
}

/**
 * 由上一帧的历史 + 本帧快照推出新历史。
 * 只对「价格相对上一点变化」的 asset 追加点;并裁掉已不在持仓中的 asset。
 * 若没有任何 asset 变化且无裁剪,返回 prev 原引用。
 */
export function samplePriceHistory(prev: PriceHistory, snapshot: Snapshot): PriceHistory {
  const liveAssets = new Set<string>();
  let changed = false;
  const next: PriceHistory = {};

  for (const position of snapshot.positions) {
    // 已结算仓订单簿已无,价会塌成 0/满额亏损,不纳入走势。
    if (position.redeemable || !(position.size > 0)) {
      continue;
    }
    const asset = position.asset;
    liveAssets.add(asset);

    const price = liveSellPrice(snapshot, asset, Number(position.curPrice));
    if (!Number.isFinite(price) || price <= 0) {
      // 拿不到有效价:保留已有序列原样。
      if (prev[asset]) {
        next[asset] = prev[asset];
      }
      continue;
    }

    const series = prev[asset];
    const last = series && series.length > 0 ? series[series.length - 1] : undefined;
    if (last === price) {
      next[asset] = series; // 同引用
      continue;
    }

    changed = true;
    const appended = series ? [...series, price] : [price];
    next[asset] = appended.length > MAX_HISTORY_POINTS ? appended.slice(appended.length - MAX_HISTORY_POINTS) : appended;
  }

  // 裁剪:prev 中存在但本帧已无的 asset 视为变化(持仓消失)。
  if (!changed) {
    for (const asset of Object.keys(prev)) {
      if (!liveAssets.has(asset)) {
        changed = true;
        break;
      }
    }
  }

  return changed ? next : prev;
}
