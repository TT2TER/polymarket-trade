import { getBestAsk, getBestBid } from '@/lib/api/clobApi';
import { impliedProb, multiplePrice, unrealizedPnl } from '@/lib/calc/pnl';
import type { OrderBook, Position, PositionView } from '@/lib/types';
import { useT } from '@/sidepanel/store';
import { PositionOps } from './PositionOps';
import { PositionRow } from './PositionRow';
import './PositionRow.css';

interface PositionCardProps {
  position: Position;
  book: OrderBook | null;
  multipliers: number[];
  lastUpdated: number;
  isOpen: boolean;
  onToggle: () => void;
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatShares(value: number): string {
  const maximumFractionDigits = value > 1000 ? 2 : 4;
  return finiteNumber(value).toLocaleString(undefined, { maximumFractionDigits });
}

function formatPrice(value: number): string {
  return finiteNumber(value).toFixed(3);
}

function formatPercent(value: number): string {
  const normalized = finiteNumber(value);
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(2)}%`;
}

function formatSignedCurrency(value: number): string {
  const normalized = finiteNumber(value);
  const sign = normalized > 0 ? '+' : '';
  return `${sign}$${normalized.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function buildPositionView(
  position: Position,
  book: OrderBook | null,
  multipliers: number[],
  lastUpdated: number,
): PositionView {
  const bestBid = getBestBid(book);
  const bestAsk = getBestAsk(book);
  const fallbackPrice = finiteNumber(position.curPrice);
  const currentPrice = bestBid > 0 ? bestBid : fallbackPrice;
  const size = finiteNumber(position.size);
  const pnl = unrealizedPnl(size, finiteNumber(position.avgPrice), currentPrice);

  return {
    position,
    book,
    bestBid,
    bestAsk,
    currentPrice,
    positionValue: currentPrice * size,
    impliedProbability: impliedProb(bestBid),
    unrealizedPnlAbsolute: pnl.absolute,
    unrealizedPnlPercent: pnl.percent,
    targetPrices: multipliers.map((multiple) => ({
      multiple,
      ...multiplePrice(finiteNumber(position.avgPrice), multiple),
    })),
    lastUpdated,
  };
}

export function PositionCard({ position, book, multipliers, lastUpdated, isOpen, onToggle }: PositionCardProps) {
  const t = useT();

  // 已结算/可赎回市场:订单簿已不存在,实时价/盈亏/盘口会显示成 0 与满额亏损,
  // 对用户有误导。这类仓位单独标注,只展示份额/均价/已实现盈亏(cashPnl)。
  if (position.redeemable) {
    const cashSide = position.cashPnl >= 0 ? 'up' : 'down';
    return (
      <div className="pq-settled">
        <div className="pq-settled__top">
          <span className="pq-settled__title">{position.title}</span>
          <span className="pq-pill pq-pill--blue">{t('position.settledRedeemable')}</span>
        </div>
        <div className="pq-settled__row">
          <span className="pq-mono pq-muted">
            {formatShares(position.size)} @ {formatPrice(position.avgPrice)}
          </span>
          <span className={`pq-mono pq-row__pnl--${cashSide}`}>
            {formatSignedCurrency(position.cashPnl)} / {formatPercent(position.percentPnl)}
          </span>
        </div>
        <button
          className="pq-settled__redeem"
          onClick={() => window.open('https://polymarket.com/portfolio', '_blank', 'noopener,noreferrer')}
          type="button"
        >
          {t('position.redeem')} ↗
        </button>
      </div>
    );
  }

  const view = buildPositionView(position, book, multipliers, lastUpdated);

  return (
    <div className={`pq-pos ${isOpen ? 'pq-pos--open' : ''}`}>
      <PositionRow
        defaultMultiplier={multipliers[0] ?? 2}
        isOpen={isOpen}
        onToggle={onToggle}
        view={view}
      />
      {isOpen ? <PositionOps multipliers={multipliers} view={view} /> : null}
    </div>
  );
}
