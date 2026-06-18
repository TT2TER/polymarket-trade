import { useState } from 'react';
import { sortAsksByBest, sortBidsByBest } from '@/lib/api/clobApi';
import type { BookLevel, OrderBook } from '@/lib/types';
import { useT } from '@/sidepanel/store';
import './OrderBookView.css';

interface OrderBookViewProps {
  book: OrderBook | null;
}

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPrice(value: string): string {
  return num(value).toFixed(3);
}

function formatSize(value: string): string {
  return num(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function OrderBookView({ book }: OrderBookViewProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (!book) {
    return <div className="pq-lob pq-lob--empty">{t('book.empty')}</div>;
  }

  const bids = sortBidsByBest(book.bids).slice(0, 5);
  const asks = sortAsksByBest(book.asks).slice(0, 5);
  const bestBid = bids[0] ?? null;
  const bestAsk = asks[0] ?? null;
  const maxSize = Math.max(1, ...bids.map((l) => num(l.size)), ...asks.map((l) => num(l.size)));
  const width = (level: BookLevel): string => `${Math.max(4, (num(level.size) / maxSize) * 100)}%`;

  if (!expanded) {
    return (
      <div className="pq-lob">
        <div className="pq-lob__head">
          <span>{t('book.title')}</span>
          <span className="pq-lob__hint">{t('book.expandHint')}</span>
        </div>
        <button className="pq-lob__top" onClick={() => setExpanded(true)} type="button">
          <span className="pq-lob__cell">
            <span className="pq-lob__depth pq-lob__depth--bid" style={{ width: bestBid ? width(bestBid) : '0%' }} />
            <span className="pq-lob__tag pq-lob__tag--bid">{t('book.bid1')}</span>
            <span className="pq-lob__price pq-lob__price--bid">{bestBid ? formatPrice(bestBid.price) : '—'}</span>
            <span className="pq-lob__size">{bestBid ? `×${formatSize(bestBid.size)}` : ''}</span>
          </span>
          <span className="pq-lob__cell">
            <span className="pq-lob__depth pq-lob__depth--ask" style={{ width: bestAsk ? width(bestAsk) : '0%' }} />
            <span className="pq-lob__tag pq-lob__tag--ask">{t('book.ask1')}</span>
            <span className="pq-lob__price pq-lob__price--ask">{bestAsk ? formatPrice(bestAsk.price) : '—'}</span>
            <span className="pq-lob__size">{bestAsk ? `×${formatSize(bestAsk.size)}` : ''}</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="pq-lob">
      <div className="pq-lob__head">
        <span>{t('book.title')}</span>
        <span className="pq-lob__hint">{t('book.collapseHint')}</span>
      </div>
      <button className="pq-lob__full" onClick={() => setExpanded(false)} type="button">
        <div className="pq-lob__col">
          {bids.length > 0 ? (
            bids.map((level, index) => (
              <div className={`pq-lob__row pq-lob__row--bid ${index === 0 ? 'pq-lob__row--best' : ''}`} key={`b-${index}-${level.price}`}>
                <span className="pq-lob__depth pq-lob__depth--bid" style={{ width: width(level) }} />
                <span className="pq-lob__price pq-lob__price--bid">{formatPrice(level.price)}</span>
                <span className="pq-lob__size">{formatSize(level.size)}</span>
              </div>
            ))
          ) : (
            <div className="pq-lob__none">{t('book.noBids')}</div>
          )}
        </div>
        <div className="pq-lob__col">
          {asks.length > 0 ? (
            asks.map((level, index) => (
              <div className={`pq-lob__row pq-lob__row--ask ${index === 0 ? 'pq-lob__row--best' : ''}`} key={`a-${index}-${level.price}`}>
                <span className="pq-lob__depth pq-lob__depth--ask" style={{ width: width(level) }} />
                <span className="pq-lob__price pq-lob__price--ask">{formatPrice(level.price)}</span>
                <span className="pq-lob__size">{formatSize(level.size)}</span>
              </div>
            ))
          ) : (
            <div className="pq-lob__none">{t('book.noAsks')}</div>
          )}
        </div>
      </button>
    </div>
  );
}
