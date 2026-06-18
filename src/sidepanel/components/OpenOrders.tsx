import { useEffect, useState } from 'react';
import type { OpenOrder } from '@polymarket/clob-client-v2';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './OpenOrders.css';

interface OpenOrdersProps {
  asset: string;
}

function formatPrice(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(3) : value;
}

function remainingSize(order: OpenOrder): string {
  const original = Number(order.original_size);
  const matched = Number(order.size_matched);
  if (!Number.isFinite(original) || !Number.isFinite(matched)) {
    return order.original_size;
  }

  return Math.max(0, original - matched).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function OpenOrders({ asset }: OpenOrdersProps) {
  const t = useT();
  const orders = useMonitorStore((state) => state.openOrders[asset] ?? []);
  const error = useMonitorStore((state) => state.orderErrors[asset] ?? null);
  const getOpenOrders = useMonitorStore((state) => state.getOpenOrders);
  const cancelOrder = useMonitorStore((state) => state.cancelOrder);
  const cancelAll = useMonitorStore((state) => state.cancelAll);
  const authStatus = useMonitorStore((state) => state.authStatus);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);

  async function handleCancel(orderID: string): Promise<void> {
    setBusyOrder(orderID);
    try {
      await cancelOrder(asset, orderID);
    } finally {
      setBusyOrder(null);
    }
  }

  async function handleCancelAll(): Promise<void> {
    setBusyOrder('all');
    try {
      await cancelAll(asset);
    } finally {
      setBusyOrder(null);
    }
  }

  useEffect(() => {
    if (authStatus.authenticated) {
      void getOpenOrders(asset);
    }
  }, [asset, authStatus.authenticated, getOpenOrders]);

  // 常驻、仅有挂单时显示;有错误也提示。
  if (orders.length === 0 && !error) {
    return null;
  }

  return (
    <section className="pq-orders">
      <div className="pq-orders__head">
        <span className="pq-orders__title">
          {t('openOrders.title')} · {orders.length}
        </span>
        <button
          className="pq-orders__cancel-all"
          disabled={!authStatus.authenticated || orders.length === 0 || busyOrder !== null}
          onClick={() => void handleCancelAll()}
          type="button"
        >
          {t('openOrders.cancelAll')}
        </button>
      </div>

      {error ? <p className="pq-form-error">{error}</p> : null}

      {orders.map((order) => (
        <div className="pq-order" key={order.id}>
          <div className="pq-order__main">
            <strong className="pq-order__line">
              {order.side} {remainingSize(order)} @ {formatPrice(order.price)}
            </strong>
            <span className="pq-order__meta">
              {order.order_type} · {order.status}
            </span>
          </div>
          <button
            className="pq-btn pq-order__cancel"
            disabled={busyOrder !== null}
            onClick={() => void handleCancel(order.id)}
            type="button"
          >
            {busyOrder === order.id ? t('openOrders.canceling') : t('confirm.cancel')}
          </button>
        </div>
      ))}
    </section>
  );
}
