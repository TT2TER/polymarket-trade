import { useEffect, useMemo, useState } from 'react';
import type { OpenOrder } from '@polymarket/clob-client-v2';
import type { Position } from '@/lib/types';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './AllOpenOrders.css';

interface AllOpenOrdersProps {
  positions: Position[];
}

type BusyState = 'all' | string | null;
type OrderMeta = {
  asset_id?: string;
  outcome?: string;
};

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPrice(value: string): string {
  return numberValue(value).toFixed(3);
}

function remainingValue(order: OpenOrder): number {
  return Math.max(0, numberValue(order.original_size) - numberValue(order.size_matched));
}

function remainingSize(order: OpenOrder): string {
  return remainingValue(order).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fillPercent(order: OpenOrder): number | null {
  const original = numberValue(order.original_size);
  if (original <= 0) {
    return null;
  }
  return Math.round((numberValue(order.size_matched) / original) * 100);
}

function sideKey(order: OpenOrder): 'BUY' | 'SELL' | string {
  return order.side.toUpperCase();
}

function orderMeta(order: OpenOrder): OrderMeta {
  return order as OpenOrder & OrderMeta;
}

function assetId(order: OpenOrder): string {
  return orderMeta(order).asset_id ?? '';
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function createdAtMs(order: OpenOrder): number {
  // OpenOrder.created_at 是数值(unix 秒);仅用于相对排序,直接用原值即可。
  const createdAt = Number(order.created_at);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function orderAmount(order: OpenOrder): number {
  return remainingValue(order) * numberValue(order.price);
}

function sortNewest(orders: OpenOrder[]): OpenOrder[] {
  return [...orders].sort((a, b) => createdAtMs(b) - createdAtMs(a));
}

export function AllOpenOrders({ positions }: AllOpenOrdersProps) {
  const t = useT();
  const allOpenOrders = useMonitorStore((state) => state.allOpenOrders);
  const allOrdersError = useMonitorStore((state) => state.allOrdersError);
  const getAllOpenOrders = useMonitorStore((state) => state.getAllOpenOrders);
  const cancelOrderGlobal = useMonitorStore((state) => state.cancelOrderGlobal);
  const cancelAllGlobal = useMonitorStore((state) => state.cancelAllGlobal);
  const authStatus = useMonitorStore((state) => state.authStatus);
  // 跟随 app 快照刷新一起重拉:用户点主「↻ 刷新」或自动刷新时,挂单也同步更新(无独立轮询)。
  const lastUpdated = useMonitorStore((state) => state.snapshot?.lastUpdated ?? 0);
  // gamma 市场元数据(按 conditionId),用于无持仓的纯买单也能显示市场名。
  const marketMeta = useMonitorStore((state) => state.marketMeta);
  const fetchMarketMeta = useMonitorStore((state) => state.fetchMarketMeta);
  const [busy, setBusy] = useState<BusyState>(null);
  const [confirming, setConfirming] = useState(false);

  const titleMap = useMemo(() => {
    const m = new Map<string, { title: string; outcome: string }>();
    for (const p of positions) {
      m.set(p.asset, { title: p.title, outcome: p.outcome });
    }
    return m;
  }, [positions]);

  const buyOrders = useMemo(() => sortNewest(allOpenOrders.filter((order) => sideKey(order) === 'BUY')), [allOpenOrders]);
  const sellOrders = useMemo(() => sortNewest(allOpenOrders.filter((order) => sideKey(order) === 'SELL')), [allOpenOrders]);

  useEffect(() => {
    if (authStatus.authenticated) {
      void getAllOpenOrders();
    }
  }, [authStatus.authenticated, getAllOpenOrders, lastUpdated]);

  // 对挂单所在市场(conditionId)拉一次 gamma 元数据,补全持仓里查不到标题的纯买单。
  // fetchMarketMeta 内部按 conditionId 去重,重复 id 不会重复请求。
  useEffect(() => {
    const ids = Array.from(new Set(allOpenOrders.map((order) => order.market).filter(Boolean)));
    if (ids.length > 0) {
      void fetchMarketMeta(ids);
    }
  }, [allOpenOrders, fetchMarketMeta]);

  // 未启用交易才整块隐藏;已认证则常驻显示(含空态),保证「↻ 刷新」始终可用——
  // 否则挂单数为 0 时面板消失,新挂的单因无轮询、无刷新按钮而永远不出现。
  if (!authStatus.authenticated) {
    return null;
  }

  const isEmpty = allOpenOrders.length === 0;

  async function handleRefresh(): Promise<void> {
    setBusy('all');
    try {
      await getAllOpenOrders();
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel(orderID: string): Promise<void> {
    setBusy(orderID);
    try {
      await cancelOrderGlobal(orderID);
    } finally {
      setBusy(null);
    }
  }

  async function handleCancelAll(): Promise<void> {
    setBusy('all');
    try {
      await cancelAllGlobal();
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  }

  function renderOrder(order: OpenOrder) {
    const id = assetId(order);
    const market = titleMap.get(id);
    const outcome = market?.outcome ?? orderMeta(order).outcome ?? '';
    // 标题优先取持仓(与列表一致);无持仓的纯买单回退到 gamma 元数据(按 conditionId);再取不到才降级短 id。
    const title = market?.title ?? marketMeta[order.market]?.title ?? null;
    const fillPct = fillPercent(order);
    const isBuy = sideKey(order) === 'BUY';
    return (
      <div className={`pq-allorders__order ${isBuy ? 'pq-allorders__order--buy' : 'pq-allorders__order--sell'}`} key={order.id}>
        <div className="pq-allorders__main">
          <strong className="pq-allorders__line">
            {remainingSize(order)} @ {formatPrice(order.price)} ≈ ${orderAmount(order).toFixed(2)}
          </strong>
          <span className="pq-allorders__market">
            {title ? `${title} · ${outcome}` : `${shortId(id)} · ${outcome}`}
          </span>
          <span className="pq-allorders__meta">
            {order.order_type} · {order.status}
            {fillPct === null ? '' : ` · ${t('allOpenOrders.fillPct', { pct: fillPct })}`}
          </span>
        </div>
        <button
          className="pq-btn pq-allorders__cancel"
          disabled={busy !== null}
          onClick={() => void handleCancel(order.id)}
          type="button"
        >
          {busy === order.id ? t('allOpenOrders.canceling') : t('confirm.cancel')}
        </button>
      </div>
    );
  }

  function renderGroup(kind: 'BUY' | 'SELL', orders: OpenOrder[]) {
    if (orders.length === 0) {
      return null;
    }
    const amount = orders.reduce((sum, order) => sum + orderAmount(order), 0).toFixed(2);
    return (
      <div className="pq-allorders__group">
        <div className="pq-allorders__groupHead">
          <span className={`pq-allorders__tag pq-allorders__tag--${kind.toLowerCase()}`}>
            {kind === 'BUY' ? t('allOpenOrders.buys') : t('allOpenOrders.sells')}
          </span>
          <span className="pq-allorders__summary">{t('allOpenOrders.groupSummary', { count: orders.length, amount })}</span>
        </div>
        <div className="pq-allorders__list">{orders.map((order) => renderOrder(order))}</div>
      </div>
    );
  }

  return (
    <section className="pq-allorders">
      <div className="pq-allorders__head">
        <span className="pq-allorders__title">
          {t('allOpenOrders.title')} · {allOpenOrders.length}
        </span>
        <div className="pq-allorders__actions">
          <button
            className="pq-allorders__btn"
            disabled={!authStatus.authenticated || busy !== null}
            onClick={() => void handleRefresh()}
            type="button"
          >
            {t('allOpenOrders.refresh')}
          </button>
          <button
            className="pq-allorders__btn pq-allorders__btn--danger"
            disabled={!authStatus.authenticated || allOpenOrders.length === 0 || busy !== null}
            onClick={() => setConfirming(true)}
            type="button"
          >
            {t('allOpenOrders.cancelAll')}
          </button>
        </div>
      </div>

      {confirming ? (
        <div className="pq-allorders__confirm">
          <span>{t('allOpenOrders.confirmCancelAll', { count: allOpenOrders.length })}</span>
          <div className="pq-allorders__confirmActions">
            <button className="pq-allorders__btn" disabled={busy !== null} onClick={() => setConfirming(false)} type="button">
              {t('allOpenOrders.cancel')}
            </button>
            <button
              className="pq-allorders__btn pq-allorders__btn--danger"
              disabled={busy !== null}
              onClick={() => void handleCancelAll()}
              type="button"
            >
              {busy === 'all' ? t('allOpenOrders.canceling') : t('allOpenOrders.confirmYes')}
            </button>
          </div>
        </div>
      ) : null}

      {allOrdersError ? <p className="pq-form-error">{allOrdersError}</p> : null}

      {isEmpty && !allOrdersError ? <p className="pq-allorders__empty">{t('allOpenOrders.empty')}</p> : null}

      {renderGroup('BUY', buyOrders)}
      {renderGroup('SELL', sellOrders)}
    </section>
  );
}
