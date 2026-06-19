import { useEffect, useState } from 'react';
import type { Position } from '@/lib/types';
import type { StopLossConfigPatch } from '@/shared/stopLossConfig';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './StopLossPanel.css';

interface StopLossPanelProps {
  position: Position;
  bestBid: number;
}

// 默认值(无既存配置时)
const DEFAULT_WINDOW_S = 30;
const DEFAULT_DROP_PCT = 12;
const DEFAULT_SELL_PCT = 50;
const DEFAULT_SLIP_PCT = 5;

function formatTime(timestamp: number, fallback: string): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleTimeString() : fallback;
}

function formatShares(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function StopLossPanel({ position }: StopLossPanelProps) {
  const t = useT();
  const config = useMonitorStore((state) => state.stopLossConfigs[position.asset]);
  const status = useMonitorStore((state) => state.stopLossStatuses[position.asset]);
  const armStopLoss = useMonitorStore((state) => state.armStopLoss);
  const disarmStopLoss = useMonitorStore((state) => state.disarmStopLoss);
  const setStopLossParams = useMonitorStore((state) => state.setStopLossParams);

  const [windowSeconds, setWindowSeconds] = useState(DEFAULT_WINDOW_S);
  const [dropPercent, setDropPercent] = useState(DEFAULT_DROP_PCT);
  const [sellPercent, setSellPercent] = useState(DEFAULT_SELL_PCT);
  const [slipPercent, setSlipPercent] = useState(DEFAULT_SLIP_PCT);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWindowSeconds(config?.windowMs ? Math.round(config.windowMs / 1000) : DEFAULT_WINDOW_S);
    setDropPercent(config?.threshold ? Number((config.threshold * 100).toFixed(1)) : DEFAULT_DROP_PCT);
    setSellPercent(config?.sellFraction ? Math.round(config.sellFraction * 100) : DEFAULT_SELL_PCT);
    // slippage 可为 0(有效值),用 != null 判定,避免被当默认。
    setSlipPercent(config?.slippage != null ? Number((config.slippage * 100).toFixed(1)) : DEFAULT_SLIP_PCT);
  }, [config?.sellFraction, config?.threshold, config?.windowMs, config?.slippage, position.asset]);

  function readPatch(): StopLossConfigPatch {
    return {
      windowMs: Math.round(windowSeconds * 1000),
      threshold: dropPercent / 100,
      sellFraction: sellPercent / 100,
      slippage: slipPercent / 100,
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
  const sellShares = (sellPercent / 100) * position.size;

  const windowFill = `linear-gradient(to right, var(--c-down) ${((windowSeconds - 1) / 119) * 100}%, var(--c-track) ${((windowSeconds - 1) / 119) * 100}%)`;
  const dropFill = `linear-gradient(to right, var(--c-down) ${((dropPercent - 3) / 97) * 100}%, var(--c-track) ${((dropPercent - 3) / 97) * 100}%)`;
  const sellFill = `linear-gradient(to right, var(--c-down) ${((sellPercent - 5) / 95) * 100}%, var(--c-track) ${((sellPercent - 5) / 95) * 100}%)`;
  const slipFill = `linear-gradient(to right, var(--c-down) ${(slipPercent / 50) * 100}%, var(--c-track) ${(slipPercent / 50) * 100}%)`;

  return (
    <div className="pq-stop">
      <div className="pq-stop__head">
        <span className="pq-strong">{t('stopLoss.title')}</span>
        <label className="pq-toggle-field">
          <span className="pq-switch pq-switch--live">
            <input
              checked={isArmed}
              disabled={isSaving}
              onChange={(event) => void saveParams(event.target.checked)}
              type="checkbox"
            />
            <span className="pq-switch__track" />
            <span className="pq-switch__knob" />
          </span>
          <span style={{ color: isArmed ? 'var(--c-down)' : 'var(--c-muted)' }}>
            {isArmed ? t('stopLoss.armed') : t('stopLoss.disarmed')}
          </span>
        </label>
      </div>

      <div className="pq-stop__slider">
        <div className="pq-trade__row">
          <span className="pq-label">{t('stopLoss.window')}</span>
          <span className="pq-stop__val">{windowSeconds}s</span>
        </div>
        <input
          className="pq-range"
          disabled={isSaving}
          max={120}
          min={1}
          onChange={(event) => setWindowSeconds(Number(event.target.value))}
          step={1}
          style={{ background: windowFill }}
          type="range"
          value={windowSeconds}
        />
      </div>

      <div className="pq-stop__slider">
        <div className="pq-trade__row">
          <span className="pq-label">{t('stopLoss.drop')}</span>
          <span className="pq-stop__val">−{dropPercent}%</span>
        </div>
        <input
          className="pq-range"
          disabled={isSaving}
          max={100}
          min={3}
          onChange={(event) => setDropPercent(Number(event.target.value))}
          step={0.5}
          style={{ background: dropFill }}
          type="range"
          value={dropPercent}
        />
      </div>

      <div className="pq-stop__slider">
        <div className="pq-trade__row">
          <span className="pq-label">{t('stopLoss.sell')}</span>
          <span className="pq-stop__val">
            {sellPercent}% <span className="pq-muted">{t('stopLoss.sellShares', { shares: formatShares(sellShares) })}</span>
          </span>
        </div>
        <input
          className="pq-range"
          disabled={isSaving}
          max={100}
          min={5}
          onChange={(event) => setSellPercent(Number(event.target.value))}
          step={1}
          style={{ background: sellFill }}
          type="range"
          value={sellPercent}
        />
      </div>

      <div className="pq-stop__slider">
        <div className="pq-trade__row">
          <span className="pq-label">{t('stopLoss.slippage')}</span>
          <span className="pq-stop__val">{slipPercent}%</span>
        </div>
        <input
          className="pq-range"
          disabled={isSaving}
          max={50}
          min={0}
          onChange={(event) => setSlipPercent(Number(event.target.value))}
          step={0.5}
          style={{ background: slipFill }}
          type="range"
          value={slipPercent}
        />
      </div>

      <div className="pq-stop__status">
        <span>
          {t('stopLoss.drop')}: {((status?.drop ?? 0) * 100).toFixed(1)}% / {((status?.threshold ?? dropPercent / 100) * 100).toFixed(1)}%
        </span>
        <span>
          {t('stopLoss.cooldown')}: {cooldownActive ? t('stopLoss.active') : t('stopLoss.ready')}
        </span>
        <span>
          {t('stopLoss.lastTrigger')}: {formatTime(status?.lastTriggeredAt ?? 0, t('stopLoss.none'))}
        </span>
      </div>

      {status?.lastResult && !status?.lastError ? <p className="pq-trade__result">{status.lastResult}</p> : null}
      {status?.lastError ? <p className="pq-form-error">{status.lastError}</p> : null}
      {error ? <p className="pq-form-error">{error}</p> : null}

      <button
        className="pq-btn pq-btn--block"
        disabled={isSaving}
        onClick={() => void saveParams(isArmed ? null : true)}
        type="button"
      >
        {isSaving ? t('stopLoss.saving') : isArmed ? t('stopLoss.update') : t('stopLoss.armButton')}
      </button>

      <p className="pq-stop__hint">{t('stopLoss.runHint')}</p>
    </div>
  );
}
