import { sortAsksByBest, sortBidsByBest } from '@/lib/api/clobApi';
import type { BookLevel, OrderBook } from '@/lib/types';
import { useT } from '@/sidepanel/store';

interface OrderBookViewProps {
  book: OrderBook | null;
}

function formatPrice(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(3) : '0.000';
}

function formatSize(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0';
}

function renderLevel(level: BookLevel, side: 'bid' | 'ask', index: number) {
  return (
    <div
      className={`book-row book-row--${side} ${index === 0 ? 'book-row--best' : ''}`}
      key={`${side}-${index}-${level.price}`}
    >
      <span>{formatPrice(level.price)}</span>
      <span>{formatSize(level.size)}</span>
    </div>
  );
}

export function OrderBookView({ book }: OrderBookViewProps) {
  const t = useT();

  if (!book) {
    return <div className="order-book order-book--empty">{t('book.empty')}</div>;
  }

  const bids = sortBidsByBest(book.bids).slice(0, 5);
  const asks = sortAsksByBest(book.asks).slice(0, 5);

  return (
    <div className="order-book">
      <div className="book-side">
        <div className="book-side__header">
          <span>{t('book.bid')}</span>
          <span>{t('book.size')}</span>
        </div>
        {bids.length > 0 ? bids.map((level, index) => renderLevel(level, 'bid', index)) : <div className="book-empty">{t('book.noBids')}</div>}
      </div>
      <div className="book-side">
        <div className="book-side__header">
          <span>{t('book.ask')}</span>
          <span>{t('book.size')}</span>
        </div>
        {asks.length > 0 ? asks.map((level, index) => renderLevel(level, 'ask', index)) : <div className="book-empty">{t('book.noAsks')}</div>}
      </div>
    </div>
  );
}
