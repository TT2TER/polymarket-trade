// #2 成交历史 + 已实现盈亏:对 data-api/trades 的真实成交按时间正序做「平均成本法」回放,
// 计算每笔卖出的已实现盈亏与总计。买入累计持仓与成本,卖出按当前均价实现盈亏。
// 这样无需额外成本基数据,完全由成交日志推出,准确。
//
// ⚠ 截断风险:若历史很长被 limit 截断,早期买入缺失会使后续卖出的成本基偏低(高估盈亏)。
// 卖出量超过已跟踪持仓时,超出部分按 0 成本计入(高估),并置 truncated 标志提示用户。

import type { Trade } from '@/lib/api/tradesApi';

export interface TradeRow extends Trade {
  /** 本笔现金额 = size × price。 */
  cashUsd: number;
  /** 卖出的已实现盈亏(买入为 undefined)。 */
  realizedPnl?: number;
}

export interface TradeHistory {
  rows: TradeRow[]; // 按时间降序(最近在前)
  totalRealized: number;
  buyCost: number;
  sellProceeds: number;
  /** 是否出现卖出量超过已跟踪持仓(历史可能被截断,已实现盈亏或偏高)。 */
  truncated: boolean;
}

interface AssetBasis {
  shares: number;
  cost: number;
}

export function computeTradeHistory(trades: Trade[]): TradeHistory {
  // 正序回放(时间升序;相同时间保持稳定)。
  const ascending = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const basis = new Map<string, AssetBasis>();
  const rowsAsc: TradeRow[] = [];
  let totalRealized = 0;
  let buyCost = 0;
  let sellProceeds = 0;
  let truncated = false;

  for (const trade of ascending) {
    const cashUsd = trade.size * trade.price;
    const book = basis.get(trade.asset) ?? { shares: 0, cost: 0 };

    if (trade.side === 'BUY') {
      book.shares += trade.size;
      book.cost += cashUsd;
      basis.set(trade.asset, book);
      buyCost += cashUsd;
      rowsAsc.push({ ...trade, cashUsd });
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
  const header = ['time', 'side', 'market', 'outcome', 'size', 'price', 'cashUsd', 'realizedPnl', 'txHash'];
  const lines = [header.join(',')];
  for (const row of history.rows) {
    const cells = [
      new Date(row.timestamp * 1000).toISOString(),
      row.side,
      row.title || '',
      row.outcome || '',
      String(row.size),
      String(row.price),
      row.cashUsd.toFixed(4),
      row.realizedPnl === undefined ? '' : row.realizedPnl.toFixed(4),
      row.transactionHash,
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}
