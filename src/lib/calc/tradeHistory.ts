// #2 成交历史 + 已实现盈亏:对 data-api/activity 的真实成交(TRADE)与赎回(REDEEM)按时间正序做
// 「平均成本法」回放,计算每笔已实现盈亏与总计。买入累计持仓与成本,卖出/赎回按当前均价实现盈亏。
//
// ⚠ 必须纳入 REDEEM:预测市场里仓位会「持有到结算、按 $1/$0 赎回」离场,而非只靠卖出。若只看卖出,
// 「买了没卖、结算输掉」的亏损会被漏算,已实现盈亏虚高。纳入后 totalRealized ≈ 真实交易现金盈亏。
//
// ⚠ 截断风险:历史很长被 limit 截断时,早期买入缺失会使后续卖出/赎回的成本基偏低(高估盈亏),置 truncated。

import type { MarketFee } from '@/lib/api/gammaApi';
import type { Redeem, Trade } from '@/lib/api/tradesApi';

export interface TradeRow {
  side: 'BUY' | 'SELL' | 'REDEEM';
  title: string;
  outcome: string;
  timestamp: number;
  size: number;
  price: number;
  /** 本笔现金额(买入花费 / 卖出所得 / 赎回所得)。 */
  cashUsd: number;
  /** 卖出/赎回的已实现盈亏(买入为 undefined);已扣买入侧 taker 费(经成本基)。 */
  realizedPnl?: number;
  /** 本笔买入 taker 手续费(估;非 taker 买入 / 卖出 / 赎回为 0)。 */
  buyFee?: number;
  isTaker: boolean;
  transactionHash: string;
  asset: string;
}

export interface TradeHistory {
  rows: TradeRow[]; // 按时间降序(最近在前)
  /** 已实现盈亏(含赎回;已扣买入侧 taker 费)≈ 真实交易现金盈亏。 */
  totalRealized: number;
  buyCost: number;
  sellProceeds: number;
  /** 赎回所得合计(持有到结算的兑付)。 */
  redeemProceeds: number;
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
  conditionId: string;
}

type Event = { ts: number; kind: 'trade'; trade: Trade } | { ts: number; kind: 'redeem'; redeem: Redeem };

export function computeTradeHistory(trades: Trade[], redeems: Redeem[] = [], feeFor?: FeeResolver): TradeHistory {
  // 合并成交与赎回,按时间正序回放(赎回时刻晚于该市场所有成交,故能正确清账剩余持仓)。
  const events: Event[] = [
    ...trades.map((trade) => ({ ts: trade.timestamp, kind: 'trade' as const, trade })),
    ...redeems.map((redeem) => ({ ts: redeem.timestamp, kind: 'redeem' as const, redeem })),
  ].sort((a, b) => a.ts - b.ts);

  const basis = new Map<string, AssetBasis>();
  const rowsAsc: TradeRow[] = [];
  let totalRealized = 0;
  let buyCost = 0;
  let sellProceeds = 0;
  let redeemProceeds = 0;
  let buyTakerFees = 0;
  let truncated = false;

  for (const event of events) {
    if (event.kind === 'redeem') {
      // 赎回:把该 conditionId 下所有剩余持仓清账,realize = 赎回所得 − 剩余成本基。
      const { redeem } = event;
      let cost = 0;
      let sharesRedeemed = 0;
      for (const book of basis.values()) {
        if (book.conditionId === redeem.conditionId && book.shares > 0) {
          cost += book.cost;
          sharesRedeemed += book.shares;
          book.shares = 0;
          book.cost = 0;
        }
      }
      const realizedPnl = redeem.usdcSize - cost;
      totalRealized += realizedPnl;
      redeemProceeds += redeem.usdcSize;
      rowsAsc.push({
        side: 'REDEEM',
        title: redeem.title,
        outcome: '',
        timestamp: redeem.timestamp,
        size: sharesRedeemed,
        price: sharesRedeemed > 0 ? redeem.usdcSize / sharesRedeemed : 0,
        cashUsd: redeem.usdcSize,
        realizedPnl,
        isTaker: false,
        transactionHash: redeem.transactionHash,
        asset: '',
      });
      continue;
    }

    const { trade } = event;
    // 金额用真实 usdcSize(贴近链上结算额),份额用 size。
    const cashUsd = trade.usdcSize;
    const book = basis.get(trade.asset) ?? { shares: 0, cost: 0, conditionId: trade.conditionId };

    if (trade.side === 'BUY') {
      // buy taker 收手续费(官方公式用 price),计入成本基(maker 买入 / 卖出免);成本基抬高 → 后续已实现盈亏降低。
      const fee = trade.isTaker ? buyTakerFee(trade.size, trade.price, feeFor?.(trade.conditionId) ?? null) : 0;
      book.shares += trade.size;
      book.cost += cashUsd + fee;
      basis.set(trade.asset, book);
      buyCost += cashUsd;
      buyTakerFees += fee;
      rowsAsc.push(toRow(trade, cashUsd, { buyFee: fee }));
      continue;
    }

    // SELL:已实现 = 卖出所得(usdcSize) − 已售份额成本基。
    sellProceeds += cashUsd;
    const avg = book.shares > 0 ? book.cost / book.shares : 0;
    const matched = Math.min(trade.size, book.shares);
    if (trade.size - matched > 0) {
      truncated = true; // 卖量超过已跟踪持仓:历史可能被截断
    }
    const realizedPnl = cashUsd - avg * matched;
    book.shares = Math.max(0, book.shares - matched);
    book.cost = Math.max(0, book.cost - avg * matched);
    basis.set(trade.asset, book);
    totalRealized += realizedPnl;
    rowsAsc.push(toRow(trade, cashUsd, { realizedPnl }));
  }

  return {
    rows: rowsAsc.reverse(), // 展示用降序
    totalRealized,
    buyCost,
    sellProceeds,
    redeemProceeds,
    buyTakerFees,
    truncated,
  };
}

function toRow(trade: Trade, cashUsd: number, extra: { realizedPnl?: number; buyFee?: number }): TradeRow {
  return {
    side: trade.side,
    title: trade.title,
    outcome: trade.outcome,
    timestamp: trade.timestamp,
    size: trade.size,
    price: trade.price,
    cashUsd,
    isTaker: trade.isTaker,
    transactionHash: trade.transactionHash,
    asset: trade.asset,
    ...extra,
  };
}

// 通用 CSV 单元格转义:含逗号/引号/换行时整体加引号并把内部引号翻倍。
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出 CSV(含表头)。realizedPnl 仅卖出/赎回有值。 */
export function tradeHistoryToCsv(history: TradeHistory): string {
  const header = ['time', 'side', 'taker', 'market', 'outcome', 'size', 'price', 'cashUsd', 'buyFee', 'realizedPnl', 'txHash'];
  const lines = [header.join(',')];
  for (const row of history.rows) {
    const cells = [
      new Date(row.timestamp * 1000).toISOString(),
      row.side,
      row.side === 'REDEEM' ? '' : row.isTaker ? 'taker' : 'maker',
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
