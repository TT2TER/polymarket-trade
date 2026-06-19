import { useEffect, useState } from 'react';
import type { Position } from '@/lib/types';
import type { PriceAlertConfigPatch } from '@/shared/priceAlertConfig';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './AlertPanel.css';

interface AlertPanelProps {
  position: Position;
}

// 输入框用字符串以允许「空 = 不设(null)」;保存时解析。价格输入用美分(¢),内部存 0~1。
function parseField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function toCentsField(price: number | null): string {
  return price === null ? '' : String(Math.round(price * 100));
}

function toField(value: number | null): string {
  return value === null ? '' : String(value);
}

// #3 到价提醒面板:每仓设置若干阈值条件;满足任一即桌面通知,不下单。
export function AlertPanel({ position }: AlertPanelProps) {
  const t = useT();
  const config = useMonitorStore((state) => state.priceAlertConfigs[position.asset]);
  const setPriceAlert = useMonitorStore((state) => state.setPriceAlert);

  const [priceAbove, setPriceAbove] = useState('');
  const [priceBelow, setPriceBelow] = useState('');
  const [pnlAbove, setPnlAbove] = useState('');
  const [pnlBelow, setPnlBelow] = useState('');
  const [valueAbove, setValueAbove] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPriceAbove(toCentsField(config?.priceAbove ?? null));
    setPriceBelow(toCentsField(config?.priceBelow ?? null));
    setPnlAbove(toField(config?.pnlPctAbove ?? null));
    setPnlBelow(toField(config?.pnlPctBelow ?? null));
    setValueAbove(toField(config?.valueAbove ?? null));
    setRepeat(config?.repeat ?? false);
  }, [
    config?.priceAbove,
    config?.priceBelow,
    config?.pnlPctAbove,
    config?.pnlPctBelow,
    config?.valueAbove,
    config?.repeat,
    position.asset,
  ]);

  const enabled = config?.enabled ?? false;

  function readPatch(nextEnabled: boolean): PriceAlertConfigPatch {
    const priceAboveCents = parseField(priceAbove);
    const priceBelowCents = parseField(priceBelow);
    return {
      enabled: nextEnabled,
      priceAbove: priceAboveCents === null ? null : priceAboveCents / 100,
      priceBelow: priceBelowCents === null ? null : priceBelowCents / 100,
      pnlPctAbove: parseField(pnlAbove),
      pnlPctBelow: parseField(pnlBelow),
      valueAbove: parseField(valueAbove),
      repeat,
    };
  }

  async function save(nextEnabled: boolean): Promise<void> {
    setError(null);
    setIsSaving(true);
    try {
      await setPriceAlert(position.asset, readPatch(nextEnabled));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  const fields: { label: string; value: string; onChange: (v: string) => void }[] = [
    { label: t('alert.priceAbove'), value: priceAbove, onChange: setPriceAbove },
    { label: t('alert.priceBelow'), value: priceBelow, onChange: setPriceBelow },
    { label: t('alert.pnlAbove'), value: pnlAbove, onChange: setPnlAbove },
    { label: t('alert.pnlBelow'), value: pnlBelow, onChange: setPnlBelow },
    { label: t('alert.valueAbove'), value: valueAbove, onChange: setValueAbove },
  ];

  return (
    <div className="pq-alert">
      <div className="pq-alert__head">
        <span className="pq-strong">{t('alert.title')}</span>
        <label className="pq-toggle-field">
          <input checked={enabled} disabled={isSaving} onChange={(e) => void save(e.target.checked)} type="checkbox" />
          <span>{t('alert.enable')}</span>
        </label>
      </div>

      <div className="pq-alert__grid">
        {fields.map((field) => (
          <label className="pq-alert__field" key={field.label}>
            <span className="pq-alert__label">{field.label}</span>
            <input
              className="pq-alert__input"
              inputMode="decimal"
              onChange={(e) => field.onChange(e.target.value)}
              placeholder={t('alert.off')}
              type="number"
              value={field.value}
            />
          </label>
        ))}
      </div>

      <div className="pq-alert__foot">
        <label className="pq-toggle-field">
          <input checked={repeat} onChange={(e) => setRepeat(e.target.checked)} type="checkbox" />
          <span>{t('alert.repeat')}</span>
        </label>
        <button className="pq-alert__save" disabled={isSaving} onClick={() => void save(enabled)} type="button">
          {t('alert.save')}
        </button>
      </div>

      <p className="pq-alert__hint">{t('alert.hint')}</p>
      {error ? <p className="pq-alert__error">{error}</p> : null}
    </div>
  );
}
