import { useEffect, useReducer } from 'react';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './SemiAutoConfirm.css';

// Phase 2b 半自动确认:semiAutoMode 开启的仓触发止损时,在此弹卡片等人工确认。
// 倒计时仅展示;真正的 fail-safe(超时自动执行)由 store 的 setTimeout 负责。
export function SemiAutoConfirm() {
  const t = useT();
  const pending = useMonitorStore((state) => state.pendingStopLoss);
  const confirmStopLoss = useMonitorStore((state) => state.confirmStopLoss);
  const cancelStopLoss = useMonitorStore((state) => state.cancelStopLoss);
  const entries = Object.values(pending);

  // 每 500ms 强制刷新倒计时显示(有待确认项时才计时)。
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (entries.length === 0) {
      return;
    }
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [entries.length]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="pq-semiauto">
      {entries.map((item) => {
        const secondsLeft = Math.max(0, Math.ceil((item.deadline - Date.now()) / 1000));
        return (
          <div className="pq-semiauto__card" key={item.asset}>
            <div className="pq-semiauto__head">⚠ {t('semiAuto.title', { title: item.title })}</div>
            <div className="pq-semiauto__body">
              {t('semiAuto.body', {
                exitLine: item.details.exitLine.toFixed(4),
                price: item.details.priceNow.toFixed(4),
                qty: item.qty.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                pct: (item.details.sellFraction * 100).toFixed(0),
              })}
            </div>
            <div className="pq-semiauto__count">{t('semiAuto.countdown', { seconds: secondsLeft })}</div>
            <div className="pq-semiauto__actions">
              <button className="pq-btn pq-btn--danger" onClick={() => confirmStopLoss(item.asset)} type="button">
                {t('semiAuto.confirm')}
              </button>
              <button className="pq-btn" onClick={() => cancelStopLoss(item.asset)} type="button">
                {t('semiAuto.cancel')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
