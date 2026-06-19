import { useEffect, useState } from 'react';
import type { Position } from '@/lib/types';
import type { ConditionalConfigPatch } from '@/shared/conditionalConfig';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './ConditionalPanel.css';

interface ConditionalPanelProps {
  position: Position;
}

function parseField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function centsField(price: number | null): string {
  return price === null ? '' : String(Math.round(price * 100));
}

function pctField(fraction: number | null): string {
  return fraction === null ? '' : String(Math.round(fraction * 100));
}

// #6 条件单 / OCO 面板:止盈腿(价≥X 卖 a%)+ 离场腿(价≤Y 卖 b%),任一成交另一取消。
export function ConditionalPanel({ position }: ConditionalPanelProps) {
  const t = useT();
  const config = useMonitorStore((state) => state.conditionalConfigs[position.asset]);
  const status = useMonitorStore((state) => state.conditionalStatuses[position.asset]);
  const armConditional = useMonitorStore((state) => state.armConditional);
  const disarmConditional = useMonitorStore((state) => state.disarmConditional);
  const setConditionalParams = useMonitorStore((state) => state.setConditionalParams);

  const [tpPrice, setTpPrice] = useState('');
  const [tpFraction, setTpFraction] = useState('');
  const [sePrice, setSePrice] = useState('');
  const [seFraction, setSeFraction] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTpPrice(centsField(config?.takeProfitPrice ?? null));
    setTpFraction(pctField(config?.takeProfitFraction ?? null));
    setSePrice(centsField(config?.stopExitPrice ?? null));
    setSeFraction(pctField(config?.stopExitFraction ?? null));
  }, [
    config?.takeProfitPrice,
    config?.takeProfitFraction,
    config?.stopExitPrice,
    config?.stopExitFraction,
    position.asset,
  ]);

  const isArmed = config?.armed ?? false;

  function readPatch(): { patch: ConditionalConfigPatch; hasLeg: boolean } {
    const tpP = parseField(tpPrice);
    const tpF = parseField(tpFraction);
    const seP = parseField(sePrice);
    const seF = parseField(seFraction);
    const tpComplete = tpP !== null && tpF !== null;
    const seComplete = seP !== null && seF !== null;
    return {
      patch: {
        takeProfitPrice: tpP === null ? null : tpP / 100,
        takeProfitFraction: tpF === null ? null : tpF / 100,
        stopExitPrice: seP === null ? null : seP / 100,
        stopExitFraction: seF === null ? null : seF / 100,
      },
      hasLeg: tpComplete || seComplete,
    };
  }

  async function save(action: 'arm' | 'disarm' | 'params'): Promise<void> {
    setError(null);
    const { patch, hasLeg } = readPatch();
    if (action === 'arm' && !hasLeg) {
      setError(t('cond.needLeg'));
      return;
    }
    setIsSaving(true);
    try {
      if (action === 'arm') {
        await armConditional(position.asset, patch);
      } else if (action === 'disarm') {
        await disarmConditional(position.asset);
      } else {
        await setConditionalParams(position.asset, patch);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  const fields: { label: string; value: string; onChange: (v: string) => void }[] = [
    { label: t('cond.tpPrice'), value: tpPrice, onChange: setTpPrice },
    { label: t('cond.tpFraction'), value: tpFraction, onChange: setTpFraction },
    { label: t('cond.sePrice'), value: sePrice, onChange: setSePrice },
    { label: t('cond.seFraction'), value: seFraction, onChange: setSeFraction },
  ];

  return (
    <div className="pq-cond">
      <div className="pq-cond__head">
        <span className="pq-strong">{t('cond.title')}</span>
        {isArmed ? <span className="pq-cond__badge">⛓ {t('cond.armed')}</span> : null}
      </div>

      <div className="pq-cond__grid">
        {fields.map((field) => (
          <label className="pq-cond__field" key={field.label}>
            <span className="pq-cond__label">{field.label}</span>
            <input
              className="pq-cond__input"
              disabled={isArmed}
              inputMode="decimal"
              onChange={(e) => field.onChange(e.target.value)}
              type="number"
              value={field.value}
            />
          </label>
        ))}
      </div>

      <div className="pq-cond__actions">
        {isArmed ? (
          <button className="pq-cond__btn pq-cond__btn--off" disabled={isSaving} onClick={() => void save('disarm')} type="button">
            {t('cond.disarm')}
          </button>
        ) : (
          <>
            <button className="pq-cond__btn" disabled={isSaving} onClick={() => void save('params')} type="button">
              {t('cond.save')}
            </button>
            <button className="pq-cond__btn pq-cond__btn--arm" disabled={isSaving} onClick={() => void save('arm')} type="button">
              {t('cond.arm')}
            </button>
          </>
        )}
      </div>

      <p className="pq-cond__hint">{t('cond.hint')}</p>
      {status?.lastResult ? <p className="pq-cond__status">{status.lastResult}</p> : null}
      {error || status?.lastError ? <p className="pq-cond__error">{error ?? status?.lastError}</p> : null}
    </div>
  );
}
