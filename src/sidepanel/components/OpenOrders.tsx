import { useEffect, useState } from 'react';
import type { OpenOrder } from '@polymarket/clob-client';
import { useMonitorStore, useT } from '@/sidepanel/store';

interface OpenOrdersProps {
  asset: string;
}

function formatPrice(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : value;
}

function remainingSize(order: OpenOrder): string {
  const original = Number(order.original_size);
  const matched = Number(order.size_matched);
  if (!Number.isFinite(original) || !Number.isFinite(matched)) {
    return order.original_size;
  }

  return Math.max(0, original - matched).toLocaleString(undefined, { maximumFractionDigits: 4 });
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refresh(): Promise<void> {
    if (!authStatus.authenticated) {
      return;
    }

    setIsRefreshing(true);
    try {
      await getOpenOrders(asset);
    } finally {
      setIsRefreshing(false);
    }
  }

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
    void refresh();
  }, [asset, authStatus.authenticated]);

  return (
    <section className="open-orders">
      <div className="open-orders__header">
        <h4>{t('openOrders.title')}</h4>
        <div>
          <button disabled={!authStatus.authenticated || isRefreshing} onClick={() => void refresh()} type="button">
            {isRefreshing ? t('openOrders.refreshing') : t('app.refresh')}
          </button>
          <button disabled={!authStatus.authenticated || orders.length === 0 || busyOrder !== null} onClick={() => void handleCancelAll()} type="button">
            {t('openOrders.cancelAll')}
          </button>
        </div>
      </div>

      {error ? <p className="open-orders__error">{error}</p> : null}
      {orders.length === 0 ? <div className="open-orders__empty">{t('openOrders.empty')}</div> : null}

      {orders.length > 0 ? (
        <div className="open-orders__list">
          {orders.map((order) => (
            <div className="open-order" key={order.id}>
              <div>
                <strong>
                  {order.side} {remainingSize(order)} @ {formatPrice(order.price)}
                </strong>
                <span>
                  {order.order_type} · {order.status}
                </span>
              </div>
              <button disabled={busyOrder !== null} onClick={() => void handleCancel(order.id)} type="button">
                {busyOrder === order.id ? t('openOrders.canceling') : t('confirm.cancel')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
