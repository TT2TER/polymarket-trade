import { useState, type FormEvent } from 'react';
import { useMonitorStore, useT } from '../store';
import './AuthBar.css';

const PRIVATE_KEY_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;

function validateImport(
  privateKey: string,
  password: string,
  confirmPassword: string,
  t: ReturnType<typeof useT>,
): string | null {
  if (!PRIVATE_KEY_RE.test(privateKey.trim())) {
    return t('auth.invalidKey');
  }
  if (password.length === 0) {
    return t('auth.missingPassword');
  }
  if (password !== confirmPassword) {
    return t('auth.passwordMismatch');
  }
  return null;
}

export function AuthBar() {
  const t = useT();
  const config = useMonitorStore((state) => state.config);
  const authStatus = useMonitorStore((state) => state.authStatus);
  const importKey = useMonitorStore((state) => state.importKey);
  const unlock = useMonitorStore((state) => state.unlock);
  const lock = useMonitorStore((state) => state.lock);
  const forgetKey = useMonitorStore((state) => state.forgetKey);

  const [privateKey, setPrivateKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 解锁后默认折叠,只露状态徽章/锁定/展开按钮,给下方持仓让出空间。
  const [expanded, setExpanded] = useState(false);

  const addressText = config.address.length > 0 ? config.address : t('auth.noWallet');

  async function handleImport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const validationError = validateImport(privateKey, password, confirmPassword, t);
    if (validationError !== null) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await importKey(privateKey, password);
      setPrivateKey('');
      setPassword('');
      setConfirmPassword('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (unlockPassword.length === 0) {
      setError(t('auth.missingPassword'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await unlock(unlockPassword);
      setUnlockPassword('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setBusy(false);
    }
  }

  async function handleForget(): Promise<void> {
    if (!window.confirm(t('auth.confirmForget'))) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await forgetKey();
      setPrivateKey('');
      setPassword('');
      setConfirmPassword('');
      setUnlockPassword('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setBusy(false);
    }
  }

  async function handleLock(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await lock();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setBusy(false);
    }
  }

  if (!authStatus.hasKey) {
    return (
      <section className="pq-section">
        <div className="pq-auth-head">
          <span>{t('auth.importTitle')}</span>
          <span className="pq-pill pq-pill--warn">{t('auth.noKey')}</span>
        </div>
        <div className="pq-section__body">
          <p className="pq-auth-note">{t('auth.importHelper')}</p>

          <div className="pq-auth-cell">
            <span className="pq-auth-cell__label">{t('auth.configuredWallet')}</span>
            <span className="pq-auth-cell__val">{addressText}</span>
          </div>

          <form className="pq-auth-form" onSubmit={handleImport}>
            <label className="pq-field">
              <span>{t('auth.privateKey')}</span>
              <div className="pq-secret-row">
                <input
                  autoComplete="off"
                  className="pq-input"
                  onChange={(event) => setPrivateKey(event.target.value)}
                  placeholder={t('auth.keyPlaceholder')}
                  type={showPrivateKey ? 'text' : 'password'}
                  value={privateKey}
                />
                <button
                  aria-label={showPrivateKey ? t('auth.hideKey') : t('auth.showKey')}
                  className="pq-btn"
                  onClick={() => setShowPrivateKey((value) => !value)}
                  title={showPrivateKey ? t('auth.hideKey') : t('auth.showKey')}
                  type="button"
                >
                  {showPrivateKey ? t('auth.hide') : t('auth.show')}
                </button>
              </div>
            </label>

            <label className="pq-field">
              <span>{t('auth.password')}</span>
              <div className="pq-secret-row">
                <input
                  autoComplete="new-password"
                  className="pq-input"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  className="pq-btn"
                  onClick={() => setShowPassword((value) => !value)}
                  title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  type="button"
                >
                  {showPassword ? t('auth.hide') : t('auth.show')}
                </button>
              </div>
            </label>

            <label className="pq-field">
              <span>{t('auth.confirmPassword')}</span>
              <input
                autoComplete="new-password"
                className="pq-input"
                onChange={(event) => setConfirmPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
              />
            </label>

            {error !== null ? <p className="pq-form-error">{error}</p> : null}

            <button className="pq-btn pq-btn--primary pq-btn--block" disabled={busy} type="submit">
              {busy ? t('auth.importing') : t('auth.importKey')}
            </button>
          </form>

          <p className="pq-auth-foot">{t('auth.walletNote')}</p>
        </div>
      </section>
    );
  }

  if (!authStatus.unlocked) {
    return (
      <section className="pq-section">
        <div className="pq-auth-head">
          <span className="pq-section__label">
            {t('auth.title')}
            <span className="pq-section__sub pq-section__sub--warn">{t('auth.locked')}</span>
          </span>
        </div>
        <div className="pq-section__body">
          <p className="pq-auth-note">{t('auth.unlockTitle')}</p>

          <form className="pq-auth-form--inline" onSubmit={handleUnlock}>
            <input
              autoComplete="current-password"
              className="pq-input"
              onChange={(event) => setUnlockPassword(event.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              type="password"
              value={unlockPassword}
            />
            <button className="pq-btn pq-btn--primary" disabled={busy} type="submit">
              {busy ? t('auth.unlocking') : t('auth.unlock')}
            </button>
          </form>

          {error !== null ? <p className="pq-form-error">{error}</p> : null}

          <button className="pq-btn pq-btn--danger pq-btn--block" disabled={busy} onClick={handleForget} type="button">
            {t('auth.forgetKey')}
          </button>
        </div>
      </section>
    );
  }

  // 解锁后:与「设置」一致的可折叠风格,默认折叠,腾空间给持仓。
  const authed = authStatus.authenticated;
  const shortAddr = (value: string): string => (value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value);

  return (
    <section className="pq-section">
      <button className="pq-section__toggle" onClick={() => setExpanded((value) => !value)} type="button">
        <span className="pq-section__label">
          {t('auth.title')}
          <span className={`pq-section__sub ${authed ? '' : 'pq-section__sub--warn'}`}>
            {authed ? t('auth.unlockedReady') : t('auth.tradingNotReady')}
          </span>
        </span>
        <span className={`pq-section__chevron ${expanded ? 'pq-section__chevron--open' : ''}`}>▾</span>
      </button>

      {expanded ? (
        <div className="pq-section__body">
          <div className={`pq-auth-card ${authed ? '' : 'pq-auth-card--warn'}`}>
            <span className="pq-auth-card__icon">{authed ? '✓' : '!'}</span>
            <span className="pq-auth-card__text">
              <span className="pq-auth-card__title">
                {authed ? t('auth.tradingEnabled') : t('auth.tradingNotReady')}
              </span>
              <span className="pq-auth-card__sub">{authed ? t('auth.clobReady') : t('auth.authFailed')}</span>
            </span>
          </div>

          <div className="pq-auth-cells">
            <div className="pq-auth-cell">
              <span className="pq-auth-cell__label">{t('auth.signerLabel')}</span>
              <span className="pq-auth-cell__val">
                {authStatus.signerAddress !== undefined ? shortAddr(authStatus.signerAddress) : '—'}
              </span>
            </div>
            <div className="pq-auth-cell">
              <span className="pq-auth-cell__label">{t('auth.proxyWallet')}</span>
              <span className="pq-auth-cell__val">{config.address ? shortAddr(config.address) : '—'}</span>
            </div>
          </div>

          <p className="pq-auth-note">{t('auth.signerDerivedNote')}</p>

          <div className="pq-auth-actions">
            <button className="pq-btn" disabled={busy} onClick={handleLock} type="button">
              🔒 {t('auth.lock')}
            </button>
            <button className="pq-btn pq-btn--danger" disabled={busy} onClick={handleForget} type="button">
              {t('auth.forgetKey')}
            </button>
          </div>

          {error !== null ? <p className="pq-form-error">{error}</p> : null}

          <p className="pq-auth-foot">{t('auth.securityNote')}</p>
        </div>
      ) : null}
    </section>
  );
}
