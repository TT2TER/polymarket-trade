import { useEffect, useRef, useState } from 'react';
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

interface LobRowProps {
  price: string;
  size: string;
  side: 'bid' | 'ask';
  isBest: boolean;
  width: string;
}

// 单档行:按槽位渲染。价格或挂单量相对上一次变化时,用 ref 直接切 class 重启 CSS 动画闪自身,
// 不用 setState(不引入额外渲染)。「移类 → 强制回流 → 加类」保证连续 tick 也能可靠重闪。
function LobRow({ price, size, side, isBest, width }: LobRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef({ price, size });
  useEffect(() => {
    const el = ref.current;
    const last = prev.current;
    const changed = last.price !== price || last.size !== size;
    prev.current = { price, size };
    if (!el || !changed) {
      return;
    }
    const cls = side === 'bid' ? 'pq-lob__row--flash-bid' : 'pq-lob__row--flash-ask';
    el.classList.remove('pq-lob__row--flash-bid', 'pq-lob__row--flash-ask');
    void el.offsetWidth; // 强制回流,重启动画
    el.classList.add(cls);
  }, [price, size, side]);

  return (
    <div className={`pq-lob__row pq-lob__row--${side} ${isBest ? 'pq-lob__row--best' : ''}`} ref={ref}>
      <span className={`pq-lob__depth pq-lob__depth--${side}`} style={{ width }} />
      <span className={`pq-lob__price pq-lob__price--${side}`}>{formatPrice(price)}</span>
      <span className="pq-lob__size">{formatSize(size)}</span>
    </div>
  );
}

interface LobCellProps {
  level: BookLevel | null;
  side: 'bid' | 'ask';
  tag: string;
  width: string;
}

// 折叠态的买1/卖1 单格:与 LobRow 同款,买1/卖1 价或量变化时闪自身。
function LobCell({ level, side, tag, width }: LobCellProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const price = level ? level.price : '';
  const size = level ? level.size : '';
  const prev = useRef({ price, size });
  useEffect(() => {
    const el = ref.current;
    const last = prev.current;
    const changed = last.price !== price || last.size !== size;
    prev.current = { price, size };
    if (!el || !changed) {
      return;
    }
    const cls = side === 'bid' ? 'pq-lob__cell--flash-bid' : 'pq-lob__cell--flash-ask';
    el.classList.remove('pq-lob__cell--flash-bid', 'pq-lob__cell--flash-ask');
    void el.offsetWidth; // 强制回流,重启动画
    el.classList.add(cls);
  }, [price, size, side]);

  return (
    <span className="pq-lob__cell" ref={ref}>
      <span className={`pq-lob__depth pq-lob__depth--${side}`} style={{ width }} />
      <span className={`pq-lob__tag pq-lob__tag--${side}`}>{tag}</span>
      <span className={`pq-lob__price pq-lob__price--${side}`}>{level ? formatPrice(price) : '—'}</span>
      <span className="pq-lob__size">{level ? `×${formatSize(size)}` : ''}</span>
    </span>
  );
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
          <LobCell level={bestBid} side="bid" tag={t('book.bid1')} width={bestBid ? width(bestBid) : '0%'} />
          <LobCell level={bestAsk} side="ask" tag={t('book.ask1')} width={bestAsk ? width(bestAsk) : '0%'} />
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
              // 按槽位 key(不含价格),使该槽位 DOM 稳定:价格或量变化时由 LobRow 内部闪烁,而非 remount。
              <LobRow
                isBest={index === 0}
                key={`b-${index}`}
                price={level.price}
                side="bid"
                size={level.size}
                width={width(level)}
              />
            ))
          ) : (
            <div className="pq-lob__none">{t('book.noBids')}</div>
          )}
        </div>
        <div className="pq-lob__col">
          {asks.length > 0 ? (
            asks.map((level, index) => (
              <LobRow
                isBest={index === 0}
                key={`a-${index}`}
                price={level.price}
                side="ask"
                size={level.size}
                width={width(level)}
              />
            ))
          ) : (
            <div className="pq-lob__none">{t('book.noAsks')}</div>
          )}
        </div>
      </button>
    </div>
  );
}
