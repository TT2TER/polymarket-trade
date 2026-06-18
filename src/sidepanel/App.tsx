import { useEffect } from 'react';
import { AuthBar } from './components/AuthBar';
import { EventGroup } from './components/EventGroup';
import { SettingsBar } from './components/SettingsBar';
import { useMonitorStore, useT } from './store';
import type { Lang } from '@/shared/i18n';

function formatLastUpdated(timestamp: number, lang: Lang, fallback: string): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') : fallback;
}

export function App() {
  const t = useT();
  const config = useMonitorStore((state) => state.config);
  const snapshot = useMonitorStore((state) => state.snapshot);
  const isLoading = useMonitorStore((state) => state.isLoading);
  const loadConfig = useMonitorStore((state) => state.loadConfig);
  const loadStopLossConfigs = useMonitorStore((state) => state.loadStopLossConfigs);
  const startMonitoring = useMonitorStore((state) => state.startMonitoring);
  const stopMonitoring = useMonitorStore((state) => state.stopMonitoring);
  const refresh = useMonitorStore((state) => state.refresh);

  useEffect(() => {
    let disposed = false;

    void Promise.all([loadConfig(), loadStopLossConfigs()]).then(() => {
      if (!disposed) {
        startMonitoring();
      }
    });

    return () => {
      disposed = true;
      stopMonitoring();
    };
  }, [loadConfig, loadStopLossConfigs, startMonitoring, stopMonitoring]);

  // 主题:system 跟随操作系统(监听 prefers-color-scheme 变化);dark/light 固定。
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = config.theme === 'system' ? (media.matches ? 'dark' : 'light') : config.theme;
      root.setAttribute('data-theme', resolved);
    };
    apply();
    if (config.theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [config.theme]);

  const hasAddress = config.address.length > 0;
  const lastUpdated = snapshot?.lastUpdated ?? 0;
  const lastUpdatedText = formatLastUpdated(lastUpdated, config.lang, t('app.waitingSnapshot'));
  // 隐藏已结算(可赎回)持仓:这些是市场已结算但未赎回的代币,默认显示,可在设置隐藏。
  const visiblePositions = (snapshot?.positions ?? []).filter(
    (position) => !config.hideSettled || !position.redeemable,
  );

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <h1>{t('app.title')}</h1>
          <p>{hasAddress ? config.address : t('app.readOnlyMonitor')}</p>
        </div>
        <span className={`badge ${hasAddress ? 'badge--ok' : 'badge--off'}`}>
          {hasAddress ? t('app.monitoring') : t('app.setup')}
        </span>
      </header>

      <section className="app__body">
        <AuthBar />
        <SettingsBar />

        {!hasAddress ? (
          <div className="empty-state">{t('app.emptySetup')}</div>
        ) : (
          <>
            {snapshot?.error ? <div className="error-banner">{snapshot.error}</div> : null}

            <div className="toolbar">
              <span>{isLoading ? t('app.loadingPositions') : t('app.snapshotReady')}</span>
              <div className="toolbar__right">
                <time>{lastUpdatedText}</time>
                <button className="toolbar__refresh" onClick={() => refresh()} type="button" title={t('app.refreshNow')}>
                  ↻ {t('app.refresh')}
                </button>
              </div>
            </div>

            <EventGroup
              books={snapshot?.books ?? {}}
              lastUpdated={lastUpdated}
              multipliers={config.multipliers}
              positions={visiblePositions}
            />
          </>
        )}
      </section>
    </main>
  );
}
