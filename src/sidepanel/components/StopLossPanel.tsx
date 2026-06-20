import { useEffect, useState } from 'react';
import type { Position } from '@/lib/types';
import type { StopLossAnchor, StopLossConfigPatch } from '@/shared/stopLossConfig';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './StopLossPanel.css';

interface StopLossPanelProps {
  position: Position;
  bestBid: number;
}

type NullablePatchKey =
  | 'anchor'
  | 'activateProfitPct'
  | 'maxLossPct'
  | 'baseThreshold'
  | 'refK'
  | 'dwellMs'
  | 'breakevenFloor'
  | 'lowPriceFloor'
  | 'sellFraction'
  | 'slippage';

interface StopLossDraft {
  anchor: StopLossAnchor | null;
  activateProfitPct: number | null;
  maxLossPct: number | null;
  baseThreshold: number | null;
  refK: number | null;
  dwellMs: number | null;
  breakevenFloor: boolean | null;
  lowPriceFloor: number | null;
  sellFraction: number | null;
  slippage: number | null;
}

const MODE_LABEL_KEYS: Record<StopLossAnchor, 'stopLoss.mode.activatedTrailing' | 'stopLoss.mode.cost' | 'stopLoss.mode.peak'> = {
  'activated-trailing': 'stopLoss.mode.activatedTrailing',
  cost: 'stopLoss.mode.cost',
  peak: 'stopLoss.mode.peak',
};

const MODE_OPTIONS: StopLossAnchor[] = ['activated-trailing', 'cost', 'peak'];

function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '--';
  }
  return value.toFixed(4);
}

function rangeFill(value: number, min: number, max: number, color = 'var(--c-down)'): string {
  const pct = ((value - min) / (max - min)) * 100;
  const clamped = Math.max(0, Math.min(100, pct));
  return `linear-gradient(to right, ${color} ${clamped}%, var(--c-track) ${clamped}%)`;
}

function emptyDraft(): StopLossDraft {
  return {
    anchor: null,
    activateProfitPct: null,
    maxLossPct: null,
    baseThreshold: null,
    refK: null,
    dwellMs: null,
    breakevenFloor: null,
    lowPriceFloor: null,
    sellFraction: null,
    slippage: null,
  };
}

export function StopLossPanel({ position }: StopLossPanelProps) {
  const t = useT();
  const config = useMonitorStore((state) => state.stopLossConfigs[position.asset]);
  const defaults = useMonitorStore((state) => state.stopLossDefaults);
  const status = useMonitorStore((state) => state.stopLossStatuses[position.asset]);
  const armStopLoss = useMonitorStore((state) => state.armStopLoss);
  const disarmStopLoss = useMonitorStore((state) => state.disarmStopLoss);
  const setStopLossParams = useMonitorStore((state) => state.setStopLossParams);

  const [draft, setDraft] = useState<StopLossDraft>(() => emptyDraft());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      anchor: config?.anchor ?? null,
      activateProfitPct: config?.activateProfitPct ?? null,
      maxLossPct: config?.maxLossPct ?? null,
      baseThreshold: config?.baseThreshold ?? config?.threshold ?? null,
      refK: config?.refK ?? null,
      dwellMs: config?.dwellMs ?? config?.windowMs ?? null,
      breakevenFloor: config?.breakevenFloor ?? null,
      lowPriceFloor: config?.lowPriceFloor ?? null,
      sellFraction: config?.sellFraction ?? null,
      slippage: config?.slippage ?? null,
    });
    setError(null);
  }, [
    config?.anchor,
    config?.activateProfitPct,
    config?.baseThreshold,
    config?.breakevenFloor,
    config?.dwellMs,
    config?.lowPriceFloor,
    config?.maxLossPct,
    config?.refK,
    config?.sellFraction,
    config?.slippage,
    config?.threshold,
    config?.windowMs,
    position.asset,
  ]);

  const isArmed = config?.armed ?? false;
  const anchor = draft.anchor ?? defaults.anchor;
  const activateProfitPct = draft.activateProfitPct ?? defaults.activateProfitPct;
  const maxLossPct = draft.maxLossPct ?? defaults.maxLossPct;
  const baseThreshold = draft.baseThreshold ?? defaults.baseThreshold;
  const sellFraction = draft.sellFraction ?? defaults.sellFraction;
  const slippage = draft.slippage ?? defaults.slippage;
  const exitLine = status?.exitLine ?? 0;
  const ref = status?.ref ?? status?.priceNow ?? 0;
  const distance = ref > 0 && exitLine > 0 ? (ref - exitLine) / ref : null;

  function setDraftField<TKey extends keyof StopLossDraft>(key: TKey, value: StopLossDraft[TKey]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function resetField(key: NullablePatchKey): void {
    setDraft((current) => ({ ...current, [key]: null }));
  }

  function readPatch(): StopLossConfigPatch {
    return {
      anchor: draft.anchor,
      activateProfitPct: draft.activateProfitPct,
      maxLossPct: draft.maxLossPct,
      baseThreshold: draft.baseThreshold,
      refK: draft.refK,
      dwellMs: draft.dwellMs,
      breakevenFloor: draft.breakevenFloor,
      lowPriceFloor: draft.lowPriceFloor,
      sellFraction: draft.sellFraction,
      slippage: draft.slippage,
      threshold: null,
      windowMs: null,
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

  const badge = (() => {
    const cooldownActive = (status?.cooldownUntil ?? 0) > Date.now();
    if (status?.breach && (status.dwellRemainingMs ?? 0) > 0) {
      return {
        label: t('stopLoss.badge.confirming', { seconds: ((status.dwellRemainingMs ?? 0) / 1000).toFixed(1) }),
        tone: 'danger',
      };
    }
    if (status?.breach && (status.dwellRemainingMs ?? 0) <= 0) {
      return { label: t('stopLoss.badge.triggered'), tone: 'danger' };
    }
    if (cooldownActive) {
      return { label: t('stopLoss.badge.cooldown'), tone: 'muted' };
    }
    if (status?.activated && status.regime === 'breakeven') {
      return { label: t('stopLoss.badge.breakeven'), tone: 'warn' };
    }
    if (status?.activated && status.regime === 'lowprice') {
      return { label: t('stopLoss.badge.lowPrice'), tone: 'warn' };
    }
    if (status?.activated) {
      return { label: t('stopLoss.badge.tracking'), tone: 'ok' };
    }
    return { label: t('stopLoss.badge.idle'), tone: 'muted' };
  })();

  const distanceTone = distance === null ? 'muted' : distance > 0.1 ? 'ok' : distance >= 0 ? 'warn' : 'danger';

  const sliderRows =
    anchor === 'activated-trailing'
      ? [
          {
            key: 'activateProfitPct' as const,
            label: t('stopLoss.label.activateProfitPct'),
            value: activateProfitPct,
            min: 0,
            max: 1,
            step: 0.01,
          },
          {
            key: 'maxLossPct' as const,
            label: t('stopLoss.label.maxLossPct'),
            value: maxLossPct,
            min: 0.01,
            max: 1,
            step: 0.01,
          },
        ]
      : anchor === 'cost'
        ? [
            {
              key: 'maxLossPct' as const,
              label: t('stopLoss.label.maxLossPct'),
              value: maxLossPct,
              min: 0.01,
              max: 1,
              step: 0.01,
            },
          ]
        : [
            {
              key: 'baseThreshold' as const,
              label: t('stopLoss.label.baseThreshold'),
              value: baseThreshold,
              min: 0.01,
              max: 1,
              step: 0.01,
            },
          ];

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

      <label className="pq-field">
        <span>{t('confirm.mode')}</span>
        <select
          className="pq-stop__select"
          disabled={isSaving}
          onChange={(event) => setDraftField('anchor', event.target.value as StopLossAnchor)}
          value={anchor}
        >
          {MODE_OPTIONS.map((mode) => (
            <option key={mode} value={mode}>
              {t(MODE_LABEL_KEYS[mode])}
            </option>
          ))}
        </select>
      </label>

      {sliderRows.map((row) => (
        <div className="pq-stop__slider" key={row.key}>
          <div className="pq-trade__row">
            <span className="pq-label">{row.label}</span>
            <span className={draft[row.key] === null ? 'pq-stop__val pq-stop__val--default' : 'pq-stop__val'}>
              {formatPct(row.value)}
            </span>
          </div>
          <input
            className="pq-range"
            disabled={isSaving}
            max={row.max}
            min={row.min}
            onChange={(event) => setDraftField(row.key, Number(event.target.value))}
            step={row.step}
            style={{ background: rangeFill(row.value, row.min, row.max) }}
            type="range"
            value={row.value}
          />
        </div>
      ))}

      <button className="pq-stop__advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)} type="button">
        <span className={`pq-section__chevron ${advancedOpen ? 'pq-section__chevron--open' : ''}`}>▾</span>
        {t('stopLoss.advanced.title')}
      </button>

      {advancedOpen ? (
        <div className="pq-stop__advanced">
          <AdvancedNumber
            defaultLabel={String(defaults.refK)}
            disabled={isSaving}
            label={t('stopLoss.label.refK')}
            max={25}
            min={1}
            onChange={(value) => setDraftField('refK', value)}
            onReset={() => resetField('refK')}
            resetLabel={t('stopLoss.advanced.resetToGlobal')}
            step={1}
            value={draft.refK}
          />
          <AdvancedNumber
            defaultLabel={formatPct(defaults.baseThreshold)}
            disabled={isSaving}
            label={t('stopLoss.label.baseThreshold')}
            max={100}
            min={1}
            onChange={(value) => setDraftField('baseThreshold', value === null ? null : value / 100)}
            onReset={() => resetField('baseThreshold')}
            resetLabel={t('stopLoss.advanced.resetToGlobal')}
            step={1}
            value={draft.baseThreshold === null ? null : Number((draft.baseThreshold * 100).toFixed(2))}
          />
          <AdvancedNumber
            defaultLabel={String(defaults.dwellMs)}
            disabled={isSaving}
            label={t('stopLoss.label.dwellMs')}
            max={300000}
            min={0}
            onChange={(value) => setDraftField('dwellMs', value === null ? null : Math.round(value))}
            onReset={() => resetField('dwellMs')}
            resetLabel={t('stopLoss.advanced.resetToGlobal')}
            step={500}
            value={draft.dwellMs}
          />
          <AdvancedBoolean
            defaultValue={defaults.breakevenFloor}
            disabled={isSaving}
            label={t('stopLoss.label.breakevenFloor')}
            onChange={(value) => setDraftField('breakevenFloor', value)}
            onReset={() => resetField('breakevenFloor')}
            resetLabel={t('stopLoss.advanced.resetToGlobal')}
            value={draft.breakevenFloor}
          />
          <AdvancedNumber
            defaultLabel={formatPct(defaults.lowPriceFloor)}
            disabled={isSaving}
            label={t('stopLoss.label.lowPriceFloor')}
            max={100}
            min={0}
            onChange={(value) => setDraftField('lowPriceFloor', value === null ? null : value / 100)}
            onReset={() => resetField('lowPriceFloor')}
            resetLabel={t('stopLoss.advanced.resetToGlobal')}
            step={1}
            value={draft.lowPriceFloor === null ? null : Number((draft.lowPriceFloor * 100).toFixed(2))}
          />
          <AdvancedNumber
            defaultLabel={formatPct(defaults.sellFraction)}
            disabled={isSaving}
            label={t('stopLoss.label.sellFraction')}
            max={100}
            min={5}
            onChange={(value) => setDraftField('sellFraction', value === null ? null : value / 100)}
            onReset={() => resetField('sellFraction')}
            resetLabel={t('stopLoss.advanced.resetToGlobal')}
            step={1}
            value={draft.sellFraction === null ? null : Number((draft.sellFraction * 100).toFixed(2))}
          />
          <AdvancedNumber
            defaultLabel={defaults.slippage === null ? '--' : formatPct(defaults.slippage)}
            disabled={isSaving}
            label={t('stopLoss.label.slippage')}
            max={50}
            min={0}
            onChange={(value) => setDraftField('slippage', value === null ? null : value / 100)}
            onReset={() => resetField('slippage')}
            resetLabel={t('stopLoss.advanced.resetToGlobal')}
            step={0.5}
            value={draft.slippage === null ? null : Number((draft.slippage * 100).toFixed(2))}
          />
        </div>
      ) : null}

      <div className="pq-stop__readout">
        <div className="pq-stop__readout-head">
          <span className={`pq-stop__badge pq-stop__badge--${badge.tone}`}>{badge.label}</span>
          <span className="pq-stop__compact">
            {t('stopLoss.label.sellFraction')} {formatPct(sellFraction, 0)} · {t('stopLoss.label.slippage')}{' '}
            {slippage === null ? '--' : formatPct(slippage)}
          </span>
        </div>
        <div className="pq-stop__metrics">
          <span>
            {t('stopLoss.exitLine')} <strong>{formatPrice(exitLine)}</strong>
          </span>
          <span>
            {t('stopLoss.ref')} <strong>{formatPrice(ref)}</strong>
          </span>
          <span className={`pq-stop__metric--${distanceTone}`}>
            {t('stopLoss.distance')} <strong>{formatPct(distance)}</strong>
          </span>
        </div>
      </div>

      {status?.lastResult && !status?.lastError ? <p className="pq-trade__result">{status.lastResult}</p> : null}
      {status?.lastError ? <p className="pq-form-error">{status.lastError}</p> : null}
      {error ? <p className="pq-form-error">{error}</p> : null}

      <button className="pq-btn pq-btn--block" disabled={isSaving} onClick={() => void saveParams(isArmed ? null : true)} type="button">
        {isSaving ? t('stopLoss.saving') : t('stopLoss.updateBtn')}
      </button>

      <p className="pq-stop__hint">{t('stopLoss.footerNote')}</p>
    </div>
  );
}

interface AdvancedNumberProps {
  defaultLabel: string;
  disabled: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number | null) => void;
  onReset: () => void;
  resetLabel: string;
  step: number;
  value: number | null;
}

function AdvancedNumber({
  defaultLabel,
  disabled,
  label,
  max,
  min,
  onChange,
  onReset,
  resetLabel,
  step,
  value,
}: AdvancedNumberProps) {
  return (
    <label className="pq-stop__advanced-field">
      <span>{label}</span>
      <div className="pq-stop__advanced-control">
        <input
          className={`pq-input ${value === null ? 'pq-stop__input--default' : ''}`}
          disabled={disabled}
          max={max}
          min={min}
          onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
          placeholder={defaultLabel}
          step={step}
          type="number"
          value={value === null ? '' : value}
        />
        <button className="pq-stop__reset" disabled={disabled || value === null} onClick={onReset} title={resetLabel} type="button">
          ↺
        </button>
      </div>
    </label>
  );
}

interface AdvancedBooleanProps {
  defaultValue: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: boolean | null) => void;
  onReset: () => void;
  resetLabel: string;
  value: boolean | null;
}

function AdvancedBoolean({ defaultValue, disabled, label, onChange, onReset, resetLabel, value }: AdvancedBooleanProps) {
  return (
    <label className="pq-stop__advanced-field">
      <span>{label}</span>
      <div className="pq-stop__advanced-control">
        <select
          className={`pq-stop__select ${value === null ? 'pq-stop__input--default' : ''}`}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === 'global') {
              onChange(null);
            } else {
              onChange(event.target.value === 'true');
            }
          }}
          value={value === null ? 'global' : String(value)}
        >
          <option value="global">{defaultValue ? 'true' : 'false'}</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
        <button className="pq-stop__reset" disabled={disabled || value === null} onClick={onReset} title={resetLabel} type="button">
          ↺
        </button>
      </div>
    </label>
  );
}
