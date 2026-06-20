// #2 成交历史 + 已实现盈亏:对 data-api/trades 的真实成交按时间正序做「平均成本法」回放,
// 计算每笔卖出的已实现盈亏与总计。买入累计持仓与成本,卖出按当前均价实现盈亏。
// 这样无需额外成本基数据,完全由成交日志推出,准确。
//
// ⚠ 截断风险:若历史很长被 limit 截断,早期买入缺失会使后续卖出的成本基偏低(高估盈亏)。
// 卖出量超过已跟踪持仓时,超出部分按 0 成本计入(高估),并置 truncated 标志提示用户。

import type { MarketFee } from '@/lib/api/gammaApi';
import type { Trade } from '@/lib/api/tradesApi';

export interface TradeRow extends Trade {
  /** 本笔现金额 = size × price。 */
  cashUsd: number;
  /** 卖出的已实现盈亏(买入为 undefined);已扣买入侧 taker 费(经成本基)。 */
  realizedPnl?: number;
  /** 本笔买入 taker 手续费(估;非 taker 买入或卖出为 0)。 */
  buyFee?: number;
}

export interface TradeHistory {
  rows: TradeRow[]; // 按时间降序(最近在前)
  /** 已实现盈亏(已扣买入侧 taker 费;卖出免费)。 */
  totalRealized: number;
  buyCost: number;
  sellProceeds: number;
  /** 买入 taker 手续费合计(估)。已并入成本基,故 totalRealized 已是净值。 */
  buyTakerFees: number;
  /** 是否出现卖出量超过已跟踪持仓(历史可能被截断,已实现盈亏或偏高)。 */
  truncated: boolean;
}

/** 按 conditionId 解析该市场官方费率表;返回 null 表示不校正手续费。 */
export type FeeResolver = (conditionId: string) => MarketFee | null;

// Polymarket 官方 taker 费(gamma feeSchedule):fee = rate × 数量 × 价 × (价×(1−价))^exponent。
// exponent=1 时峰值在 ~2/3(非 50¢);仅 buy taker 收取(sell 豁免、maker 免)。
function buyTakerFee(size: number, price: number, fee: MarketFee | null): number {
  if (!fee || !fee.enabled || !(fee.rate > 0) || !(price > 0) || price >= 1) {
    return 0;
  }
  return fee.rate * size * price * Math.pow(price * (1 - price), fee.exponent);
}

interface AssetBasis {
  shares: number;
  cost: number;
}

export function computeTradeHistory(trades: Trade[], feeFor?: FeeResolver): TradeHistory {
  // 正序回放(时间升序;相同时间保持稳定)。
  const ascending = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const basis = new Map<string, AssetBasis>();
  const rowsAsc: TradeRow[] = [];
  let totalRealized = 0;
  let buyCost = 0;
  let sellProceeds = 0;
  let buyTakerFees = 0;
  let truncated = false;

  for (const trade of ascending) {
    const cashUsd = trade.size * trade.price;
    const book = basis.get(trade.asset) ?? { shares: 0, cost: 0 };

    if (trade.side === 'BUY') {
      // buy taker 收手续费,计入成本基(maker 买入 / 卖出免);成本基抬高 → 后续卖出已实现盈亏降低。
      const fee = trade.isTaker ? buyTakerFee(trade.size, trade.price, feeFor?.(trade.conditionId) ?? null) : 0;
      book.shares += trade.size;
      book.cost += cashUsd + fee;
      basis.set(trade.asset, book);
      buyCost += cashUsd;
      buyTakerFees += fee;
      rowsAsc.push({ ...trade, cashUsd, buyFee: fee });
      continue;
    }

    // SELL:按当前均价实现盈亏。
    sellProceeds += cashUsd;
    const avg = book.shares > 0 ? book.cost / book.shares : 0;
    const matched = Math.min(trade.size, book.shares);
    const excess = trade.size - matched; // 超过已跟踪持仓的部分(截断或异常)
    if (excess > 0) {
      truncated = true;
    }
    // 已匹配部分按成本基实现;超出部分按 0 成本实现(高估,仅截断时出现)。
    const realizedPnl = (trade.price - avg) * matched + trade.price * excess;
    book.shares = Math.max(0, book.shares - matched);
    book.cost = Math.max(0, book.cost - avg * matched);
    basis.set(trade.asset, book);
    totalRealized += realizedPnl;
    rowsAsc.push({ ...trade, cashUsd, realizedPnl });
  }

  return {
    rows: rowsAsc.reverse(), // 展示用降序
    totalRealized,
    buyCost,
    sellProceeds,
    buyTakerFees,
    truncated,
  };
}

// 通用 CSV 单元格转义:含逗号/引号/换行时整体加引号并把内部引号翻倍。
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出 CSV(含表头)。realizedPnl 仅卖出有值。 */
export function tradeHistoryToCsv(history: TradeHistory): string {
  const header = ['time', 'side', 'taker', 'market', 'outcome', 'size', 'price', 'cashUsd', 'buyFee', 'realizedPnl', 'txHash'];
  const lines = [header.join(',')];
  for (const row of history.rows) {
    const cells = [
      new Date(row.timestamp * 1000).toISOString(),
      row.side,
      row.isTaker ? 'taker' : 'maker',
      row.title || '',
      row.outcome || '',
      String(row.size),
      String(row.price),
      row.cashUsd.toFixed(4),
      row.buyFee ? row.buyFee.toFixed(4) : '',
      row.realizedPnl === undefined ? '' : row.realizedPnl.toFixed(4),
      row.transactionHash,
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}
