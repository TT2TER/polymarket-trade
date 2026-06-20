import { useEffect } from 'react';
import { tradeHistoryToCsv } from '@/lib/calc/tradeHistory';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './TradeHistory.css';

interface TradeHistoryProps {
  onClose: () => void;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function money(value: number): string {
  return `$${finite(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number): string {
  const v = finite(value);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function sideClass(value: number): string {
  return value > 0 ? 'pq-hist__pnl--up' : value < 0 ? 'pq-hist__pnl--down' : '';
}

function shortTime(unixSec: number, lang: string): string {
  return new Date(unixSec * 1000).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// #2 成交历史弹窗:展示 data-api/trades 真实成交 + 平均成本法算出的每笔/总已实现盈亏 + CSV 导出。
export function TradeHistory({ onClose }: TradeHistoryProps) {
  const t = useT();
  const lang = useMonitorStore((state) => state.config.lang);
  const history = useMonitorStore((state) => state.tradeHistory);
  const loading = useMonitorStore((state) => state.tradesLoading);
  const error = useMonitorStore((state) => state.tradesError);
  const fetchTrades = useMonitorStore((state) => state.fetchTrades);

  useEffect(() => {
    void fetchTrades();
  }, [fetchTrades]);

  function exportCsv(): void {
    if (!history) {
      return;
    }
    const blob = new Blob([tradeHistoryToCsv(history)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `polymarket-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const rows = history?.rows ?? [];

  return (
    <div aria-modal="true" className="pq-hist__overlay" role="dialog">
      <div className="pq-hist">
        <div className="pq-hist__head">
          <h3 className="pq-hist__title">{t('history.title')}</h3>
          <button className="pq-hist__x" onClick={onClose} type="button" aria-label={t('history.close')}>
            ✕
          </button>
        </div>

        {history ? (
          <div className="pq-hist__summary">
            <div className="pq-hist__cell">
              <span className="pq-hist__label">{t('history.totalRealized')}</span>
              <strong className={`pq-hist__num ${sideClass(history.totalRealized)}`}>
                {signedMoney(history.totalRealized)}
              </strong>
            </div>
            <div className="pq-hist__cell">
              <span className="pq-hist__label">{t('history.buyCost')}</span>
              <strong className="pq-hist__num">{money(history.buyCost)}</strong>
            </div>
            <div className="pq-hist__cell">
              <span className="pq-hist__label">{t('history.sellProceeds')}</span>
              <strong className="pq-hist__num">{money(history.sellProceeds)}</strong>
            </div>
          </div>
        ) : null}

        {history && history.buyTakerFees > 0 ? (
          <p className="pq-hist__feenote">
            {t('history.buyFees')}: <strong>{money(history.buyTakerFees)}</strong> — {t('history.feeNote')}
          </p>
        ) : null}

        {history?.truncated ? <p className="pq-hist__warn">{t('history.truncated')}</p> : null}

        <div className="pq-hist__list">
          {loading ? <p className="pq-hist__msg">{t('history.loading')}</p> : null}
          {error ? <p className="pq-hist__err">{error}</p> : null}
          {!loading && !error && rows.length === 0 ? <p className="pq-hist__msg">{t('history.empty')}</p> : null}
          {rows.map((row, index) => (
            <div className="pq-hist__row" key={`${row.transactionHash}-${row.asset}-${row.timestamp}-${index}`}>
              <div className="pq-hist__l1">
                <span className={`pq-hist__side pq-hist__side--${row.side === 'BUY' ? 'buy' : 'sell'}`}>{row.side}</span>
                <span className="pq-hist__market">{row.title} · {row.outcome}</span>
              </div>
              <div className="pq-hist__l2">
                <span className="pq-hist__when">{shortTime(row.timestamp, lang)}</span>
                <span className="pq-hist__detail">
                  {finite(row.size).toLocaleString(undefined, { maximumFractionDigits: 2 })} @ {Math.round(finite(row.price) * 100)}¢ · {money(row.cashUsd)}
                  {row.buyFee && row.buyFee > 0 ? <span className="pq-hist__fee"> · {t('history.buyFees')} {money(row.buyFee)}</span> : null}
                  {row.realizedPnl !== undefined ? (
                    <span className={`pq-hist__pnl ${sideClass(row.realizedPnl)}`}> · {signedMoney(row.realizedPnl)}</span>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="pq-hist__foot">
          <button className="pq-hist__btn" disabled={loading} onClick={() => void fetchTrades()} type="button">
            ↻ {t('history.refresh')}
          </button>
          <button className="pq-hist__btn" disabled={!history || rows.length === 0} onClick={exportCsv} type="button">
            {t('history.export')}
          </button>
          <button className="pq-hist__btn pq-hist__btn--primary" onClick={onClose} type="button">
            {t('history.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
