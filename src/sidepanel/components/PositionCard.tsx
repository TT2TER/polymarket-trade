import { getBestAsk, getBestBid } from '@/lib/api/clobApi';
import { impliedProb, multiplePrice, unrealizedPnl } from '@/lib/calc/pnl';
import type { OrderBook, Position, PositionView } from '@/lib/types';
import { useT } from '@/sidepanel/store';
import { OpenOrders } from './OpenOrders';
import { OrderActions } from './OrderActions';
import { OrderBookView } from './OrderBookView';
import { StopLossPanel } from './StopLossPanel';

interface PositionCardProps {
  position: Position;
  book: OrderBook | null;
  multipliers: number[];
  lastUpdated: number;
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
  return `${finiteNumber(value).toFixed(2)}%`;
}

function formatSignedCurrency(value: number): string {
  const normalized = finiteNumber(value);
  const sign = normalized > 0 ? '+' : '';
  return `${sign}$${normalized.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCurrency(value: number): string {
  return `$${finiteNumber(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(timestamp: number, fallback: string): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleTimeString() : fallback;
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

export function PositionCard({ position, book, multipliers, lastUpdated }: PositionCardProps) {
  const t = useT();

  // 已结算/可赎回市场:订单簿已不存在,实时价/盈亏/盘口会显示成 0 与满额亏损,
  // 对用户有误导。这类仓位单独标注,只展示份额/均价/已实现盈亏(cashPnl)。
  if (position.redeemable) {
    const cashClass = position.cashPnl >= 0 ? 'metric-value--positive' : 'metric-value--negative';
    return (
      <article className="position-card position-card--settled">
        <div className="position-card__header">
          <div>
            <h3>{position.title}</h3>
            <p>{position.outcome}</p>
          </div>
          <span className="badge badge--settled">{t('position.settledRedeemable')}</span>
        </div>
        <div className="metrics-grid">
          <div className="metric">
            <span className="metric-label">{t('position.shares')}</span>
            <strong className="metric-value">{formatShares(position.size)}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">{t('position.avg')}</span>
            <strong className="metric-value">{formatPrice(position.avgPrice)}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">{t('position.cashPnl')}</span>
            <strong className={`metric-value ${cashClass}`}>
              {formatSignedCurrency(position.cashPnl)} / {formatPercent(position.percentPnl)}
            </strong>
          </div>
        </div>
        <div className="position-card__actions">
          <button
            className="position-card__redeem"
            onClick={() => window.open('https://polymarket.com/portfolio', '_blank', 'noopener,noreferrer')}
            type="button"
          >
            {t('position.redeem')}
          </button>
          <small className="position-card__redeem-note">{t('position.redeemNote')}</small>
        </div>
      </article>
    );
  }

  const view = buildPositionView(position, book, multipliers, lastUpdated);
  const pnlClass = view.unrealizedPnlAbsolute >= 0 ? 'metric-value--positive' : 'metric-value--negative';

  return (
    <article className="position-card">
      <div className="position-card__header">
        <div>
          <h3>{view.position.title}</h3>
          <p>{view.position.outcome}</p>
        </div>
        <span className="position-card__time">{formatTime(view.lastUpdated, t('position.waiting'))}</span>
      </div>

      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">{t('position.shares')}</span>
          <strong className="metric-value">{formatShares(view.position.size)}</strong>
        </div>
        <div className="metric">
          <span className="metric-label">{t('position.avg')}</span>
          <strong className="metric-value">{formatPrice(view.position.avgPrice)}</strong>
        </div>
        <div className="metric">
          <span className="metric-label">{t('position.bestBid')}</span>
          <strong className="metric-value">{view.bestBid > 0 ? formatPrice(view.bestBid) : t('position.notAvailable')}</strong>
        </div>
        <div className="metric">
          <span className="metric-label">{t('position.bestAsk')}</span>
          <strong className="metric-value">{view.bestAsk > 0 ? formatPrice(view.bestAsk) : t('position.notAvailable')}</strong>
        </div>
        <div className="metric">
          <span className="metric-label">{t('position.value')}</span>
          <strong className="metric-value">{formatCurrency(view.positionValue)}</strong>
        </div>
        <div className="metric">
          <span className="metric-label">{t('position.impliedProb')}</span>
          <strong className="metric-value">{formatPercent(view.impliedProbability * 100)}</strong>
        </div>
        <div className="metric">
          <span className="metric-label">{t('position.unrealizedPnl')}</span>
          <strong className={`metric-value ${pnlClass}`}>
            {formatSignedCurrency(view.unrealizedPnlAbsolute)} / {formatPercent(view.unrealizedPnlPercent)}
          </strong>
        </div>
      </div>

      <div className="targets">
        {view.targetPrices.map((target, index) => (
          <span
            className={`target ${target.reachable ? 'target--reachable' : 'target--capped'}`}
            key={`${target.multiple}-${index}`}
          >
            {target.multiple}x {formatPrice(target.price)}
            {!target.reachable ? ` ${t('position.capped')}` : ''}
          </span>
        ))}
      </div>

      <StopLossPanel bestBid={view.bestBid} position={view.position} />
      <OrderActions book={view.book} multipliers={multipliers} position={view.position} />
      <OpenOrders asset={view.position.asset} />
      <OrderBookView book={view.book} />
    </article>
  );
}
