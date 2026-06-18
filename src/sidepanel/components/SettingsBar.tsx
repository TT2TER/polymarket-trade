import { FormEvent, useEffect, useState } from 'react';
import type { Lang } from '@/shared/i18n';
import type { ThemeMode } from '@/shared/config';
import { useMonitorStore, useT } from '@/sidepanel/store';

const THEME_MODES: ThemeMode[] = ['system', 'dark', 'light'];
const THEME_LABEL_KEYS = {
  system: 'settings.themeSystem',
  dark: 'settings.themeDark',
  light: 'settings.themeLight',
} as const;

interface SettingsBarProps {
  defaultOpen?: boolean;
}

function isValidAddress(address: string): boolean {
  return address.startsWith('0x') && address.length === 42;
}

function intervalFromSeconds(value: string, fallbackMs: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1000) : fallbackMs;
}

export function SettingsBar({ defaultOpen = false }: SettingsBarProps) {
  const t = useT();
  const config = useMonitorStore((state) => state.config);
  const setConfig = useMonitorStore((state) => state.setConfig);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [address, setAddress] = useState(config.address);
  const [positionsSeconds, setPositionsSeconds] = useState(String(config.positionsIntervalMs / 1000));
  const [booksSeconds, setBooksSeconds] = useState(String(config.booksIntervalMs / 1000));
  const [dryRun, setDryRun] = useState(config.dryRun);
  const [maxOrderUsd, setMaxOrderUsd] = useState(String(config.maxOrderUsd));
  const [stopLossMaxUsd, setStopLossMaxUsd] = useState(String(config.stopLossMaxUsd));
  const [hideSettled, setHideSettled] = useState(config.hideSettled);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setAddress(config.address);
    setPositionsSeconds(String(config.positionsIntervalMs / 1000));
    setBooksSeconds(String(config.booksIntervalMs / 1000));
    setDryRun(config.dryRun);
    setMaxOrderUsd(String(config.maxOrderUsd));
    setStopLossMaxUsd(String(config.stopLossMaxUsd));
    setHideSettled(config.hideSettled);
  }, [config]);

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
    }
  }, [defaultOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedAddress = address.trim();
    if (!isValidAddress(normalizedAddress)) {
      setError(t('settings.invalidAddress'));
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const parsedMaxOrderUsd = Number(maxOrderUsd);
      const parsedStopLossMaxUsd = Number(stopLossMaxUsd);
      await setConfig({
        ...config,
        address: normalizedAddress,
        positionsIntervalMs: intervalFromSeconds(positionsSeconds, config.positionsIntervalMs),
        booksIntervalMs: intervalFromSeconds(booksSeconds, config.booksIntervalMs),
        dryRun,
        hideSettled,
        maxOrderUsd: Number.isFinite(parsedMaxOrderUsd) && parsedMaxOrderUsd > 0 ? parsedMaxOrderUsd : config.maxOrderUsd,
        stopLossMaxUsd:
          Number.isFinite(parsedStopLossMaxUsd) && parsedStopLossMaxUsd > 0 ? parsedStopLossMaxUsd : config.stopLossMaxUsd,
      });
      setIsOpen(false);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(t('settings.saveFailed', { message }));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLangChange(lang: Lang): Promise<void> {
    if (config.lang === lang) {
      return;
    }

    setError(null);
    try {
      await setConfig({ ...config, lang });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(t('settings.saveFailed', { message }));
    }
  }

  async function handleThemeChange(theme: ThemeMode): Promise<void> {
    if (config.theme === theme) {
      return;
    }

    setError(null);
    try {
      await setConfig({ ...config, theme });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(t('settings.saveFailed', { message }));
    }
  }

  return (
    <section className="settings-bar">
      <button className="settings-bar__toggle" onClick={() => setIsOpen((value) => !value)} type="button">
        <span>{t('settings.title')}</span>
        <span>{isOpen ? t('settings.hide') : t('settings.show')}</span>
      </button>

      {isOpen ? (
        <form className="settings-form" onSubmit={handleSubmit}>
          <div className="settings-form__language">
            <span>{t('settings.language')}</span>
            <div className="settings-form__lang-toggle">
              <button
                className={config.lang === 'zh' ? 'settings-form__lang-button settings-form__lang-button--active' : 'settings-form__lang-button'}
                onClick={() => void handleLangChange('zh')}
                type="button"
              >
                中
              </button>
              <button
                className={config.lang === 'en' ? 'settings-form__lang-button settings-form__lang-button--active' : 'settings-form__lang-button'}
                onClick={() => void handleLangChange('en')}
                type="button"
              >
                EN
              </button>
            </div>
          </div>

          <div className="settings-form__language">
            <span>{t('settings.theme')}</span>
            <div className="settings-form__lang-toggle">
              {THEME_MODES.map((mode) => (
                <button
                  className={
                    config.theme === mode ? 'settings-form__lang-button settings-form__lang-button--active' : 'settings-form__lang-button'
                  }
                  key={mode}
                  onClick={() => void handleThemeChange(mode)}
                  type="button"
                >
                  {t(THEME_LABEL_KEYS[mode])}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-form__group">
            <h3>{t('settings.monitoringGroup')}</h3>
            <label>
              <span>{t('settings.proxyWallet')}</span>
              <input
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => setAddress(event.target.value)}
                placeholder="0x..."
                spellCheck={false}
                value={address}
              />
            </label>
            <label className="settings-form__checkbox">
              <input checked={hideSettled} onChange={(event) => setHideSettled(event.target.checked)} type="checkbox" />
              <span>{t('settings.hideSettled')}</span>
            </label>
          </div>

          <div className="settings-form__intervals">
            <label>
              <span>{t('settings.positionsPoll')}</span>
              <input min="1" onChange={(event) => setPositionsSeconds(event.target.value)} step="1" type="number" value={positionsSeconds} />
            </label>
            <label>
              <span>{t('settings.booksPoll')}</span>
              <input min="1" onChange={(event) => setBooksSeconds(event.target.value)} step="1" type="number" value={booksSeconds} />
            </label>
          </div>

          <div className="settings-form__group">
            <h3>{t('settings.tradingGroup')}</h3>
            <div className="settings-form__trading">
              <label className="settings-form__checkbox">
                <input checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} type="checkbox" />
                <span>{t('settings.dryRun')}</span>
              </label>
              <label>
                <span>{t('settings.maxOrderUsd')}</span>
                <input min="0.01" onChange={(event) => setMaxOrderUsd(event.target.value)} step="1" type="number" value={maxOrderUsd} />
              </label>
              <label>
                <span>{t('settings.stopLossMaxUsd')}</span>
                <input
                  min="0.01"
                  onChange={(event) => setStopLossMaxUsd(event.target.value)}
                  step="1"
                  type="number"
                  value={stopLossMaxUsd}
                />
              </label>
            </div>
          </div>

          {error ? <p className="settings-form__error">{error}</p> : null}

          <button className="settings-form__save" disabled={isSaving} type="submit">
            {isSaving ? t('settings.saving') : t('settings.save')}
          </button>
        </form>
      ) : null}
    </section>
  );
}
