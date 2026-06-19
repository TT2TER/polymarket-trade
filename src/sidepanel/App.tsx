import { useEffect, useState } from 'react';
import { AuthBar } from './components/AuthBar';
import { EquitySummary } from './components/EquitySummary';
import { EventGroup } from './components/EventGroup';
import { ExposureBar } from './components/ExposureBar';
import { SettingsBar } from './components/SettingsBar';
import { useMonitorStore, useT } from './store';
import type { Lang } from '@/shared/i18n';

function formatLastUpdated(timestamp: number, lang: Lang, fallback: string): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US') : fallback;
}

function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function App() {
  const t = useT();
  const config = useMonitorStore((state) => state.config);
  const snapshot = useMonitorStore((state) => state.snapshot);
  const isLoading = useMonitorStore((state) => state.isLoading);
  const loadConfig = useMonitorStore((state) => state.loadConfig);
  const loadStopLossConfigs = useMonitorStore((state) => state.loadStopLossConfigs);
  const loadPriceAlertConfigs = useMonitorStore((state) => state.loadPriceAlertConfigs);
  const loadTargetMultipliers = useMonitorStore((state) => state.loadTargetMultipliers);
  const startMonitoring = useMonitorStore((state) => state.startMonitoring);
  const stopMonitoring = useMonitorStore((state) => state.stopMonitoring);
  const refresh = useMonitorStore((state) => state.refresh);
  const todayPnl = useMonitorStore((state) => state.todayPnl);
  const fetchTodayPnl = useMonitorStore((state) => state.fetchTodayPnl);
  // 手风琴:同时只展开一个持仓(跨事件组互斥)。仅 UI 局部状态。
  const [openAsset, setOpenAsset] = useState<string | null>(null);
  const toggleOpen = (asset: string) => setOpenAsset((current) => (current === asset ? null : asset));

  useEffect(() => {
    let disposed = false;

    void Promise.all([loadConfig(), loadStopLossConfigs(), loadPriceAlertConfigs(), loadTargetMultipliers()]).then(() => {
      if (!disposed) {
        startMonitoring();
      }
    });

    return () => {
      disposed = true;
      stopMonitoring();
    };
  }, [loadConfig, loadStopLossConfigs, loadPriceAlertConfigs, loadTargetMultipliers, startMonitoring, stopMonitoring]);

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

  // 涨跌配色风格(cn=红涨绿跌 / us=绿涨红跌):翻转所有按盈亏着色的部分。
  useEffect(() => {
    document.documentElement.setAttribute('data-color-style', config.colorStyle);
  }, [config.colorStyle]);

  const hasAddress = config.address.length > 0;

  // 汇总条「今日」:低频拉滚动 24h P&L(60s 一次),与 WS 行情解耦。showSummary 关则不拉。
  useEffect(() => {
    if (!hasAddress || !config.showSummary) {
      return undefined;
    }
    void fetchTodayPnl();
    const id = setInterval(() => void fetchTodayPnl(), 60_000);
    return () => clearInterval(id);
  }, [hasAddress, config.showSummary, config.address, fetchTodayPnl]);

  const lastUpdated = snapshot?.lastUpdated ?? 0;
  const lastUpdatedText = formatLastUpdated(lastUpdated, config.lang, t('app.waitingSnapshot'));
  // 隐藏已结算(可赎回)持仓:这些是市场已结算但未赎回的代币,默认显示,可在设置隐藏。
  const visiblePositions = (snapshot?.positions ?? []).filter(
    (position) => !config.hideSettled || !position.redeemable,
  );

  return (
    <main className="app">
      <header className="pq-header">
        <div className="pq-header__top">
          <div className="pq-brand">
            <span className="pq-brand__logo">P</span>
            <span className="pq-brand__text">
              <span className="pq-brand__name">POLYQUANT</span>
              <span className="pq-brand__sub">{t('app.brandSubtitle')}</span>
            </span>
          </div>
          <div className="pq-header__right">
            <span className={`pq-pill ${config.dryRun ? 'pq-pill--dry' : 'pq-pill--live'}`}>
              {config.dryRun ? t('mode.dryRun') : t('mode.live')}
            </span>
            <span className="pq-live">
              <span className="pq-live__dot" />
              {t('app.live')}
            </span>
          </div>
        </div>
        <div className="pq-header__row2">
          <span className="pq-addr">{hasAddress ? shortenAddress(config.address) : t('app.readOnlyMonitor')}</span>
          <span className={`pq-status ${hasAddress ? '' : 'pq-status--off'}`}>
            <span className="pq-status__dot" />
            {hasAddress ? t('app.monitoring') : t('app.setup')}
          </span>
        </div>
      </header>

      <section className="app__body">
        {hasAddress && config.showSummary ? (
          <>
            <EquitySummary positions={snapshot?.positions ?? []} todayPnl={todayPnl} />
            <ExposureBar positions={snapshot?.positions ?? []} />
          </>
        ) : null}

        <AuthBar />
        <SettingsBar />

        {!hasAddress ? (
          <div className="empty-state">{t('app.emptySetup')}</div>
        ) : (
          <>
            {snapshot?.error ? <div className="error-banner">{snapshot.error}</div> : null}

            <div className="pq-toolbar">
              <span>{isLoading ? t('app.loadingPositions') : t('app.snapshotReady')}</span>
              <div className="pq-toolbar__right">
                <time className="pq-toolbar__time">{lastUpdatedText}</time>
                <button className="pq-toolbar__refresh" onClick={() => refresh()} type="button" title={t('app.refreshNow')}>
                  ↻ {t('app.refresh')}
                </button>
              </div>
            </div>

            <EventGroup
              books={snapshot?.books ?? {}}
              lastUpdated={lastUpdated}
              multipliers={config.multipliers}
              onToggle={toggleOpen}
              openAsset={openAsset}
              positions={visiblePositions}
            />
          </>
        )}

        <footer className="pq-footer">
          <span>{t('footer.stopNote')}</span>
          <span className="pq-footer__ver">{t('footer.version')}</span>
        </footer>
      </section>
    </main>
  );
}
