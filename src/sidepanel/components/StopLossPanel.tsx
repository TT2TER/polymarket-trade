import { useEffect, useMemo, useState } from 'react';
import { autoSellFraction, autoThreshold } from '@/lib/stoploss/detector';
import type { Position } from '@/lib/types';
import type { StopLossConfigPatch } from '@/shared/stopLossConfig';
import { useMonitorStore, useT } from '@/sidepanel/store';

interface StopLossPanelProps {
  position: Position;
  bestBid: number;
}

function formatInputNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatTime(timestamp: number, fallback: string): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleTimeString() : fallback;
}

function parseNullableSeconds(value: string, t: ReturnType<typeof useT>): number | null {
  if (value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(t('stopLoss.windowPositiveError'));
  }

  return Math.round(parsed * 1000);
}

function parseNullablePercent(value: string, label: string, t: ReturnType<typeof useT>): number | null {
  if (value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(t('stopLoss.percentPositiveError', { label }));
  }

  return parsed / 100;
}

export function StopLossPanel({ position, bestBid }: StopLossPanelProps) {
  const t = useT();
  const config = useMonitorStore((state) => state.stopLossConfigs[position.asset]);
  const status = useMonitorStore((state) => state.stopLossStatuses[position.asset]);
  const armStopLoss = useMonitorStore((state) => state.armStopLoss);
  const disarmStopLoss = useMonitorStore((state) => state.disarmStopLoss);
  const setStopLossParams = useMonitorStore((state) => state.setStopLossParams);
  const [windowSeconds, setWindowSeconds] = useState('');
  const [thresholdPercent, setThresholdPercent] = useState('');
  const [sellPercent, setSellPercent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWindowSeconds(config?.windowMs ? formatInputNumber(config.windowMs / 1000) : '');
    setThresholdPercent(config?.threshold ? formatInputNumber(config.threshold * 100) : '');
    setSellPercent(config?.sellFraction ? formatInputNumber(config.sellFraction * 100) : '');
  }, [config?.sellFraction, config?.threshold, config?.windowMs, position.asset]);

  const autoValues = useMemo(() => {
    const price = bestBid > 0 ? bestBid : position.curPrice;
    const threshold = autoThreshold(price);
    const sellFraction = autoSellFraction(threshold, threshold, Math.max(0, price * position.size));
    return {
      windowSeconds: '30',
      thresholdPercent: (threshold * 100).toFixed(2),
      sellPercent: (sellFraction * 100).toFixed(2),
    };
  }, [bestBid, position.curPrice, position.size]);

  function readPatch(): StopLossConfigPatch {
    return {
      windowMs: parseNullableSeconds(windowSeconds, t),
      threshold: parseNullablePercent(thresholdPercent, t('stopLoss.drop'), t),
      sellFraction: parseNullablePercent(sellPercent, t('stopLoss.sell'), t),
    };
  }

  async function saveParams(nextArmed: boolean | null): Promise<void> {
    setError(null);
    setIsSaving(true);
    try {
      const patch = readPatch();
      if (nextArmed === true) {
        await armStopLoss(position.asset, patch);
      } else if (nextArmed === false) {
        await disarmStopLoss(position.asset);
      } else {
        await setStopLossParams(position.asset, patch);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  const isArmed = config?.armed ?? false;
  const cooldownActive = isArmed && (status?.cooldownUntil ?? 0) > Date.now();
  const statusText = isArmed ? t('stopLoss.armed') : t('stopLoss.disarmed');
  const resultText = status?.lastError ?? status?.lastResult ?? t('stopLoss.none');

  return (
    <section className="stop-loss-panel">
      <div className="stop-loss-panel__header">
        <h4>{t('stopLoss.title')}</h4>
        <label className="stop-loss-panel__toggle">
          <input
            checked={isArmed}
            disabled={isSaving}
            onChange={(event) => void saveParams(event.target.checked)}
            type="checkbox"
          />
          <span>{statusText}</span>
        </label>
      </div>

      <div className="stop-loss-panel__grid">
        <label>
          <span>{t('stopLoss.window')}</span>
          <input
            disabled={isSaving}
            min="5"
            onChange={(event) => setWindowSeconds(event.target.value)}
            placeholder={autoValues.windowSeconds}
            step="1"
            type="number"
            value={windowSeconds}
          />
        </label>
        <label>
          <span>{t('stopLoss.drop')}</span>
          <input
            disabled={isSaving}
            min="1"
            onChange={(event) => setThresholdPercent(event.target.value)}
            placeholder={autoValues.thresholdPercent}
            step="0.1"
            type="number"
            value={thresholdPercent}
          />
        </label>
        <label>
          <span>{t('stopLoss.sell')}</span>
          <input
            disabled={isSaving}
            min="5"
            onChange={(event) => setSellPercent(event.target.value)}
            placeholder={autoValues.sellPercent}
            step="1"
            type="number"
            value={sellPercent}
          />
        </label>
        <button disabled={isSaving} onClick={() => void saveParams(null)} type="button">
          {isSaving ? t('stopLoss.saving') : t('stopLoss.apply')}
        </button>
      </div>

      <div className="stop-loss-panel__status">
        <span>{t('stopLoss.lastTrigger')}: {formatTime(status?.lastTriggeredAt ?? 0, t('stopLoss.none'))}</span>
        <span>{t('stopLoss.cooldown')}: {cooldownActive ? t('stopLoss.active') : t('stopLoss.ready')}</span>
        <span>{t('stopLoss.drop')}: {formatPercent(status?.drop ?? 0)} / {formatPercent(status?.threshold ?? autoThreshold(bestBid))}</span>
        <span>{t('stopLoss.lastResult')}: {resultText}</span>
      </div>

      {error ? <p className="stop-loss-panel__error">{error}</p> : null}
    </section>
  );
}
