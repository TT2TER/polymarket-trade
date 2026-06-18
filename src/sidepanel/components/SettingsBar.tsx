import { FormEvent, useEffect, useState } from 'react';
import type { Lang } from '@/shared/i18n';
import type { ColorStyle, ThemeMode } from '@/shared/config';
import { useMonitorStore, useT } from '@/sidepanel/store';

const THEME_MODES: ThemeMode[] = ['system', 'dark', 'light'];
const THEME_LABEL_KEYS = {
  system: 'settings.themeSystem',
  dark: 'settings.themeDark',
  light: 'settings.themeLight',
} as const;

const COLOR_STYLES: ColorStyle[] = ['cn', 'us'];
const COLOR_STYLE_LABEL_KEYS = {
  cn: 'settings.colorStyleCn',
  us: 'settings.colorStyleUs',
} as const;

interface SettingsBarProps {
  defaultOpen?: boolean;
}

function isValidAddress(address: string): boolean {
  return address.startsWith('0x') && address.length === 42;
}

export function SettingsBar({ defaultOpen = false }: SettingsBarProps) {
  const t = useT();
  const config = useMonitorStore((state) => state.config);
  const setConfig = useMonitorStore((state) => state.setConfig);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [address, setAddress] = useState(config.address);
  const [dryRun, setDryRun] = useState(config.dryRun);
  const [maxOrderUsd, setMaxOrderUsd] = useState(String(config.maxOrderUsd));
  const [stopLossMaxUsd, setStopLossMaxUsd] = useState(String(config.stopLossMaxUsd));
  const [hideSettled, setHideSettled] = useState(config.hideSettled);
  const [showSummary, setShowSummary] = useState(config.showSummary);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setAddress(config.address);
    setDryRun(config.dryRun);
    setMaxOrderUsd(String(config.maxOrderUsd));
    setStopLossMaxUsd(String(config.stopLossMaxUsd));
    setHideSettled(config.hideSettled);
    setShowSummary(config.showSummary);
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
      // 轮询间隔不在 UI 暴露,沿用 config 现值。止损滑点已移到每仓(止损 Tab)。
      await setConfig({
        ...config,
        address: normalizedAddress,
        dryRun,
        hideSettled,
        showSummary,
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

  async function handleColorStyleChange(colorStyle: ColorStyle): Promise<void> {
    if (config.colorStyle === colorStyle) {
      return;
    }

    setError(null);
    try {
      await setConfig({ ...config, colorStyle });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(t('settings.saveFailed', { message }));
    }
  }

  return (
    <section className="pq-section">
      <button className="pq-section__toggle" onClick={() => setIsOpen((value) => !value)} type="button">
        <span className="pq-section__label">
          {t('settings.title')}
          <span className={`pq-pill ${config.dryRun ? 'pq-pill--dry' : 'pq-pill--live'}`}>
            {config.dryRun ? t('mode.dryRun') : t('mode.live')}
          </span>
        </span>
        <span className={`pq-section__chevron ${isOpen ? 'pq-section__chevron--open' : ''}`}>▾</span>
      </button>

      {isOpen ? (
        <form className="pq-section__body" onSubmit={handleSubmit}>
          <label className="pq-field">
            <span>{t('settings.proxyWallet')}</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              className="pq-input"
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x..."
              spellCheck={false}
              value={address}
            />
          </label>

          <label className="pq-field">
            <span>{t('settings.theme')}</span>
            <div className="pq-seg pq-seg--full">
              {THEME_MODES.map((mode) => (
                <button
                  className={`pq-seg__btn ${config.theme === mode ? 'pq-seg__btn--active' : ''}`}
                  key={mode}
                  onClick={() => void handleThemeChange(mode)}
                  type="button"
                >
                  {t(THEME_LABEL_KEYS[mode])}
                </button>
              ))}
            </div>
          </label>

          <label className="pq-field">
            <span>{t('settings.colorStyle')}</span>
            <div className="pq-seg pq-seg--full">
              {COLOR_STYLES.map((style) => (
                <button
                  className={`pq-seg__btn ${config.colorStyle === style ? 'pq-seg__btn--active' : ''}`}
                  key={style}
                  onClick={() => void handleColorStyleChange(style)}
                  type="button"
                >
                  {t(COLOR_STYLE_LABEL_KEYS[style])}
                </button>
              ))}
            </div>
          </label>

          <div className="pq-field-row">
            <div className="pq-field-row" style={{ gap: 8 }}>
              <span className="pq-label">{t('settings.language')}</span>
              <div className="pq-seg">
                <button
                  className={`pq-seg__btn ${config.lang === 'zh' ? 'pq-seg__btn--active' : ''}`}
                  onClick={() => void handleLangChange('zh')}
                  type="button"
                >
                  中文
                </button>
                <button
                  className={`pq-seg__btn ${config.lang === 'en' ? 'pq-seg__btn--active' : ''}`}
                  onClick={() => void handleLangChange('en')}
                  type="button"
                >
                  EN
                </button>
              </div>
            </div>
            <label className="pq-toggle-field">
              <span className="pq-switch pq-switch--neutral">
                <input checked={hideSettled} onChange={(event) => setHideSettled(event.target.checked)} type="checkbox" />
                <span className="pq-switch__track" />
                <span className="pq-switch__knob" />
              </span>
              <span>{t('settings.hideSettled')}</span>
            </label>
          </div>

          <label className="pq-toggle-field">
            <span className="pq-switch pq-switch--neutral">
              <input checked={showSummary} onChange={(event) => setShowSummary(event.target.checked)} type="checkbox" />
              <span className="pq-switch__track" />
              <span className="pq-switch__knob" />
            </span>
            <span>{t('settings.showSummary')}</span>
          </label>

          <hr className="pq-divider" />

          <div className="pq-field-row">
            <span className="pq-strong">{t('settings.tradingGroup')}</span>
            <label className="pq-toggle-field">
              <span className="pq-switch">
                <input checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} type="checkbox" />
                <span className="pq-switch__track" />
                <span className="pq-switch__knob" />
              </span>
              <span style={{ color: dryRun ? 'var(--c-up)' : 'var(--c-down)' }}>
                {dryRun ? t('mode.dryRun') : t('mode.live')}
              </span>
            </label>
          </div>

          <div className="pq-grid-2">
            <label className="pq-field">
              <span>{t('settings.maxOrderUsd')}</span>
              <input
                className="pq-input"
                min="0.01"
                onChange={(event) => setMaxOrderUsd(event.target.value)}
                step="1"
                type="number"
                value={maxOrderUsd}
              />
            </label>
            <label className="pq-field">
              <span>{t('settings.stopLossMaxUsd')}</span>
              <input
                className="pq-input"
                min="0.01"
                onChange={(event) => setStopLossMaxUsd(event.target.value)}
                step="1"
                type="number"
                value={stopLossMaxUsd}
              />
            </label>
          </div>

          {error ? <p className="pq-form-error">{error}</p> : null}

          <button className="pq-btn pq-btn--primary pq-btn--block" disabled={isSaving} type="submit">
            {isSaving ? t('settings.saving') : t('settings.save')}
          </button>
        </form>
      ) : null}
    </section>
  );
}
