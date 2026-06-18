import { useEffect, useState } from 'react';
import { getBestAsk, getBestBid } from '@/lib/api/clobApi';
import { N_TICKS, nFromPos, posFromN } from '@/lib/calc/multiplierSlider';
import { computeNxCostQuantity } from '@/lib/trading/orders';
import type { OrderBook, Position } from '@/lib/types';
import type { I18nKey } from '@/shared/i18n';
import type { PrepareOrderRequest } from '@/shared/messages';
import { useMonitorStore, useT } from '@/sidepanel/store';
import { ConfirmDialog, type ConfirmOrderDetails } from './ConfirmDialog';
import './OrderActions.css';

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
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0';
}

function formatMoney(value: number): string {
  return `≈$${(Number.isFinite(value) ? value : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatCents(price: number): string {
  const c = (Number.isFinite(price) ? price : 0) * 100;
  if (c > 0 && c < 9.5) {
    return `${c.toFixed(1)}¢`;
  }
  return `${Math.round(c)}¢`;
}

function formatN(value: number): string {
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

export function OrderActions({ position, book, multipliers }: OrderActionsProps) {
  const t = useT();
  const authStatus = useMonitorStore((state) => state.authStatus);
  const config = useMonitorStore((state) => state.config);
  const prepareOrder = useMonitorStore((state) => state.prepareOrder);
  const confirmOrder = useMonitorStore((state) => state.confirmOrder);
  const getOpenOrders = useMonitorStore((state) => state.getOpenOrders);
  const isTrading = useMonitorStore((state) => state.isTrading);
  const storedMultiplier = useMonitorStore((state) => state.targetMultipliers[position.asset]);
  const setTargetMultiplier = useMonitorStore((state) => state.setTargetMultiplier);

  const [sellPercent, setSellPercent] = useState(100);
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const bestBid = getBestBid(book);
  const bestAsk = getBestAsk(book);
  const targetMultiplier = storedMultiplier ?? multipliers[0] ?? 2;

  // 切仓时重置卖出比例为满仓。
  useEffect(() => {
    setSellPercent(100);
    setError(null);
    setLastResult(null);
  }, [position.asset]);

  const size = position.size;
  const sellShares = (sellPercent / 100) * size;
  const estAmount = sellShares * (bestBid > 0 ? bestBid : position.curPrice);
  const canSell = authStatus.authenticated && !isTrading && sellShares > 0;
  const disabledReason = authStatus.authenticated ? undefined : t('order.authRequired');

  // 编辑「卖出数量」(股)反推百分比,与滑块双向联动。
  function setSellShares(shares: number): void {
    if (!(size > 0) || !Number.isFinite(shares)) {
      return;
    }
    setSellPercent(Math.max(0, Math.min(100, (shares / size) * 100)));
  }

  // 按钮上的内联派生值。
  const askLabel = bestAsk > 0 ? formatCents(bestAsk) : '';
  const bidLabel = bestBid > 0 ? formatCents(bestBid) : '';
  const nLabel = formatN(targetMultiplier);
  const targetPrice = targetMultiplier * position.avgPrice;
  const targetLabel = targetPrice > 1 ? t('ops.capped') : formatCents(targetPrice);
  // 「回收成本」按整仓计算可卖股数(独立于卖出滑块)。
  const recoverShares = computeNxCostQuantity(
    position.avgPrice,
    size,
    bestBid > 0 ? bestBid : position.curPrice,
    targetMultiplier,
  ).qty;

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
      base.price = bestAsk;
      base.size = sellShares;
    } else if (mode === 'taker') {
      base.size = sellShares;
    } else if (mode === 'limitN') {
      base.n = targetMultiplier;
      base.size = sellShares;
    } else {
      base.n = targetMultiplier;
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

  const nPos = posFromN(targetMultiplier);
  const sellFill = `linear-gradient(to right, var(--c-up) ${sellPercent}%, var(--c-track) ${sellPercent}%)`;
  const nFill = `linear-gradient(to right, var(--c-target) ${nPos}%, var(--c-track) ${nPos}%)`;

  return (
    <div className="pq-trade" title={disabledReason}>
      {/* 卖出数量 */}
      <div className="pq-trade__block">
        <div className="pq-trade__row">
          <span className="pq-label">{t('order.sellQty')}</span>
          <span className="pq-trade__derived">
            <input
              aria-label={t('order.sellQty')}
              className="pq-trade__shares"
              disabled={!authStatus.authenticated}
              max={Math.floor(size)}
              min={0}
              onChange={(event) => setSellShares(Number(event.target.value))}
              step={1}
              type="number"
              value={Math.round(sellShares)}
            />
            <span className="pq-muted"> / {formatShares(size)} {t('order.shares')}</span>
            <span className="pq-trade__amount"> · {formatMoney(estAmount)}</span>
          </span>
        </div>
        <input
          className="pq-range"
          disabled={!authStatus.authenticated}
          max={100}
          min={0}
          onChange={(event) => setSellPercent(Number(event.target.value))}
          step={1}
          style={{ background: sellFill }}
          type="range"
          value={sellPercent}
        />
        <div className="pq-trade__buttons">
          <button className="pq-btn" disabled={!canSell} onClick={() => void openConfirm('maker')} type="button">
            {t('order.pricePriorityBtn', { price: askLabel }).trim()}
          </button>
          <button
            className="pq-btn pq-btn--sell"
            disabled={!canSell || bestBid <= 0}
            onClick={() => void openConfirm('taker')}
            type="button"
          >
            {t('order.fillPriorityBtn', { price: bidLabel }).trim()}
          </button>
        </div>
      </div>

      {/* 目标倍数 N */}
      <div className="pq-trade__block">
        <div className="pq-trade__row">
          <span className="pq-label">{t('order.targetMultiplier')}</span>
          <span className="pq-trade__derived pq-trade__derived--target">
            {t('order.targetArrow', { n: nLabel, price: targetLabel })}
          </span>
        </div>
        <input
          className="pq-range"
          disabled={!authStatus.authenticated}
          max={100}
          min={0}
          onChange={(event) => setTargetMultiplier(position.asset, nFromPos(Number(event.target.value)))}
          step={0.5}
          style={{ background: nFill }}
          type="range"
          value={nPos}
        />
        <div className="pq-trade__ticks">
          {N_TICKS.map((tick) => (
            <span className="pq-trade__tick" key={tick} style={{ left: `${posFromN(tick)}%` }}>
              {tick}×
            </span>
          ))}
        </div>
        <p className="pq-trade__hint">{t('order.nHint')}</p>
        <div className="pq-trade__buttons">
          <button className="pq-btn" disabled={!canSell} onClick={() => void openConfirm('limitN')} type="button">
            {t('order.nLimitAllBtn', { n: nLabel, shares: formatShares(sellShares) })}
          </button>
          <button
            className="pq-btn"
            disabled={!authStatus.authenticated || isTrading || bestBid <= 0}
            onClick={() => void openConfirm('nxCost')}
            type="button"
          >
            {t('order.recoverNBtn', { shares: formatShares(recoverShares), n: nLabel })}
          </button>
        </div>
      </div>

      {config.dryRun ? <p className="pq-trade__guard">{t('order.dryRunGuard')}</p> : null}
      {error ? <p className="pq-form-error">{error}</p> : null}
      {lastResult ? <p className="pq-trade__result">{lastResult}</p> : null}

      <ConfirmDialog
        details={pending?.details ?? null}
        error={pending ? error : null}
        isSubmitting={isTrading}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  );
}
