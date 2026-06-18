import { useEffect, useState } from 'react';
import { getBestAsk, getBestBid } from '@/lib/api/clobApi';
import type { OrderBook, Position } from '@/lib/types';
import type { I18nKey } from '@/shared/i18n';
import type { PrepareOrderRequest } from '@/shared/messages';
import { useMonitorStore, useT } from '@/sidepanel/store';
import { ConfirmDialog, type ConfirmOrderDetails } from './ConfirmDialog';

type ActionMode = PrepareOrderRequest['mode'];

interface OrderActionsProps {
  position: Position;
  book: OrderBook | null;
  multipliers: number[];
}

interface PendingOrder {
  nonce: string;
  details: ConfirmOrderDetails;
}

const MODE_LABEL_KEYS: Record<ActionMode, I18nKey> = {
  maker: 'order.pricePriority',
  taker: 'order.fillPriority',
  limitN: 'order.nLimit',
  nxCost: 'order.recoverCost',
};

function formatShares(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '0';
}

function parsePositive(input: string, label: string, t: ReturnType<typeof useT>): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(t('order.positiveNumber', { label }));
  }

  return value;
}

export function OrderActions({ position, book, multipliers }: OrderActionsProps) {
  const t = useT();
  const authStatus = useMonitorStore((state) => state.authStatus);
  const config = useMonitorStore((state) => state.config);
  const prepareOrder = useMonitorStore((state) => state.prepareOrder);
  const confirmOrder = useMonitorStore((state) => state.confirmOrder);
  const getOpenOrders = useMonitorStore((state) => state.getOpenOrders);
  const isTrading = useMonitorStore((state) => state.isTrading);
  const [makerPrice, setMakerPrice] = useState('');
  const [makerSize, setMakerSize] = useState('');
  const [takerSize, setTakerSize] = useState('');
  const [limitN, setLimitN] = useState('');
  const [limitSize, setLimitSize] = useState('');
  const [recoverN, setRecoverN] = useState('');
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const bestBid = getBestBid(book);
  const bestAsk = getBestAsk(book);
  const firstMultiplier = String(multipliers[0] ?? 2);

  useEffect(() => {
    setMakerPrice(bestAsk > 0 ? bestAsk.toFixed(4) : '');
    setMakerSize(String(position.size));
    setTakerSize(String(position.size));
    setLimitN(firstMultiplier);
    setLimitSize(String(position.size));
    setRecoverN(firstMultiplier);
  }, [bestAsk, firstMultiplier, position.asset, position.size]);

  const disabledReason = authStatus.authenticated ? undefined : t('order.authRequired');

  // 仅构建发往后台的输入;价格/数量/估值的权威计算与上限校验都在后台完成(H2)。
  function buildPayload(mode: ActionMode): Omit<PrepareOrderRequest, 'type'> {
    const base: Omit<PrepareOrderRequest, 'type'> = {
      tokenID: position.asset,
      mode,
      negRisk: position.negativeRisk,
      avgPrice: position.avgPrice,
      positionSize: position.size,
      bestBid,
      bestAsk,
    };

    if (mode === 'maker') {
      base.price = parsePositive(makerPrice, t('order.makerPrice'), t);
      base.size = parsePositive(makerSize, t('order.orderSize'), t);
    } else if (mode === 'taker') {
      base.size = parsePositive(takerSize, t('order.orderSize'), t);
    } else if (mode === 'limitN') {
      base.n = parsePositive(limitN, t('order.multiplier'), t);
      base.size = parsePositive(limitSize, t('order.orderSize'), t);
    } else {
      base.n = parsePositive(recoverN, t('order.multiplier'), t);
    }

    return base;
  }

  async function openConfirm(mode: ActionMode): Promise<void> {
    setError(null);
    setLastResult(null);
    try {
      const payload = buildPayload(mode);
      const { nonce, preview } = await prepareOrder(payload);
      setPending({
        nonce,
        details: {
          title: `${position.title} - ${position.outcome}`,
          modeLabelKey: MODE_LABEL_KEYS[mode],
          price: preview.price,
          size: preview.size,
          estAmount: preview.estAmount,
          orderType: preview.orderType,
          dryRun: preview.dryRun,
          postOnly: preview.postOnly,
          warning: preview.warning,
          remaining: preview.remaining,
        },
      });
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : String(buildError));
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!pending) {
      return;
    }

    try {
      setError(null);
      const result = await confirmOrder(pending.nonce, position.asset);
      setLastResult(
        result.dryRun
          ? t('order.resultDryRun', {
              orderType: result.orderType,
              size: formatShares(result.size),
              price: result.price.toFixed(4),
            })
          : t('order.resultSubmitted', {
              orderType: result.orderType,
              size: formatShares(result.size),
              price: result.price.toFixed(4),
            }),
      );
      setPending(null);
      await getOpenOrders(position.asset);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  }

  return (
    <section className="order-actions" title={disabledReason}>
      <div className="order-actions__header">
        <h4>{t('order.trade')}</h4>
        <span className={`mode-pill ${config.dryRun ? 'mode-pill--dry' : 'mode-pill--live'}`}>
          {config.dryRun ? t('order.dryRun') : t('order.maxUsd', { amount: config.maxOrderUsd })}
        </span>
      </div>

      <div className="order-actions__grid">
        <div className="order-action">
          <div className="order-action__title">{t('order.pricePriority')}</div>
          <label>
            <span>{t('order.price')}</span>
            <input disabled={!authStatus.authenticated} onChange={(event) => setMakerPrice(event.target.value)} step="0.0001" type="number" value={makerPrice} />
          </label>
          <label>
            <span>{t('order.size')}</span>
            <input disabled={!authStatus.authenticated} onChange={(event) => setMakerSize(event.target.value)} step="0.0001" type="number" value={makerSize} />
          </label>
          <button disabled={!authStatus.authenticated || isTrading} onClick={() => void openConfirm('maker')} type="button">
            {t('order.placeMaker')}
          </button>
        </div>

        <div className="order-action">
          <div className="order-action__title">{t('order.fillPriority')}</div>
          <label>
            <span>{t('order.price')}</span>
            <input disabled step="0.0001" type="number" value={bestBid > 0 ? bestBid.toFixed(4) : ''} />
          </label>
          <label>
            <span>{t('order.size')}</span>
            <input disabled={!authStatus.authenticated} onChange={(event) => setTakerSize(event.target.value)} step="0.0001" type="number" value={takerSize} />
          </label>
          <button disabled={!authStatus.authenticated || isTrading || bestBid <= 0} onClick={() => void openConfirm('taker')} type="button">
            {t('order.sellNow')}
          </button>
        </div>

        <div className="order-action">
          <div className="order-action__title">{t('order.nLimit')}</div>
          <label>
            <span>{t('order.n')}</span>
            <input disabled={!authStatus.authenticated} onChange={(event) => setLimitN(event.target.value)} step="0.1" type="number" value={limitN} />
          </label>
          <label>
            <span>{t('order.size')}</span>
            <input disabled={!authStatus.authenticated} onChange={(event) => setLimitSize(event.target.value)} step="0.0001" type="number" value={limitSize} />
          </label>
          <button disabled={!authStatus.authenticated || isTrading} onClick={() => void openConfirm('limitN')} type="button">
            {t('order.placeLimit')}
          </button>
        </div>

        <div className="order-action">
          <div className="order-action__title">{t('order.recoverCost')}</div>
          <label>
            <span>{t('order.n')}</span>
            <input disabled={!authStatus.authenticated} onChange={(event) => setRecoverN(event.target.value)} step="0.1" type="number" value={recoverN} />
          </label>
          <div className="order-action__hint">{t('order.bid')} {bestBid > 0 ? bestBid.toFixed(4) : t('position.notAvailable')}</div>
          <button disabled={!authStatus.authenticated || isTrading || bestBid <= 0} onClick={() => void openConfirm('nxCost')} type="button">
            {t('order.recover')}
          </button>
        </div>
      </div>

      {error ? <p className="order-actions__error">{error}</p> : null}
      {lastResult ? <p className="order-actions__result">{lastResult}</p> : null}

      <ConfirmDialog details={pending?.details ?? null} isSubmitting={isTrading} onCancel={() => setPending(null)} onConfirm={() => void handleConfirm()} />
    </section>
  );
}
