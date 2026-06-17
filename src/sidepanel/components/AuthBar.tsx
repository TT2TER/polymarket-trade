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
      <section className="auth-bar">
        <div className="auth-bar__header">
          <div>
            <h2>{t('auth.importTitle')}</h2>
            <p>{t('auth.importHelper')}</p>
          </div>
          <span className="auth-bar__status auth-bar__status--off">{t('auth.noKey')}</span>
        </div>

        <div className="auth-bar__address">
          <span>{t('auth.configuredWallet')}</span>
          <strong>{addressText}</strong>
          <small>{t('auth.walletNote')}</small>
        </div>

        <form className="auth-bar__form" onSubmit={handleImport}>
          <label>
            <span>{t('auth.privateKey')}</span>
            <div className="auth-bar__secret-row">
              <input
                autoComplete="off"
                onChange={(event) => setPrivateKey(event.target.value)}
                placeholder={t('auth.keyPlaceholder')}
                type={showPrivateKey ? 'text' : 'password'}
                value={privateKey}
              />
              <button
                aria-label={showPrivateKey ? t('auth.hideKey') : t('auth.showKey')}
                onClick={() => setShowPrivateKey((value) => !value)}
                title={showPrivateKey ? t('auth.hideKey') : t('auth.showKey')}
                type="button"
              >
                {showPrivateKey ? t('auth.hide') : t('auth.show')}
              </button>
            </div>
          </label>

          <label>
            <span>{t('auth.password')}</span>
            <div className="auth-bar__secret-row">
              <input
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                onClick={() => setShowPassword((value) => !value)}
                title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                type="button"
              >
                {showPassword ? t('auth.hide') : t('auth.show')}
              </button>
            </div>
          </label>

          <label>
            <span>{t('auth.confirmPassword')}</span>
            <input
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
            />
          </label>

          {error !== null ? <p className="auth-bar__error">{error}</p> : null}

          <button className="auth-bar__primary" disabled={busy} type="submit">
            {busy ? t('auth.importing') : t('auth.importKey')}
          </button>
        </form>
      </section>
    );
  }

  if (!authStatus.unlocked) {
    return (
      <section className="auth-bar">
        <div className="auth-bar__header">
          <div>
            <h2>{t('auth.title')}</h2>
            <p>{t('auth.unlockTitle')}</p>
          </div>
          <span className="auth-bar__status auth-bar__status--locked">{t('auth.locked')}</span>
        </div>

        <form className="auth-bar__form auth-bar__form--inline" onSubmit={handleUnlock}>
          <input
            autoComplete="current-password"
            onChange={(event) => setUnlockPassword(event.target.value)}
            placeholder={t('auth.passwordPlaceholder')}
            type="password"
            value={unlockPassword}
          />
          <button className="auth-bar__primary" disabled={busy} type="submit">
            {busy ? t('auth.unlocking') : t('auth.unlock')}
          </button>
        </form>

        {error !== null ? <p className="auth-bar__error">{error}</p> : null}

        <button className="auth-bar__danger" disabled={busy} onClick={handleForget} type="button">
          {t('auth.forgetKey')}
        </button>
      </section>
    );
  }

  return (
    <section className="auth-bar">
      <div className="auth-bar__header">
        <div>
          <h2>{t('auth.title')}</h2>
          <p>{addressText}</p>
        </div>
        <span className="auth-bar__status auth-bar__status--ok">{t('auth.unlocked')}</span>
      </div>

      <p className={authStatus.authenticated ? 'auth-bar__auth-ok' : 'auth-bar__auth-warn'}>
        {authStatus.authenticated ? t('auth.authReady') : t('auth.authFailed')}
      </p>

      {authStatus.signerAddress !== undefined ? (
        <div className="auth-bar__address">
          <span>{t('auth.signerAddress')}</span>
          <strong>{authStatus.signerAddress}</strong>
          <small>{t('auth.signerNote')}</small>
        </div>
      ) : null}

      <div className="auth-bar__actions">
        <button className="auth-bar__secondary" disabled={busy} onClick={handleLock} type="button">
          {t('auth.lock')}
        </button>
        <button className="auth-bar__danger" disabled={busy} onClick={handleForget} type="button">
          {t('auth.forgetKey')}
        </button>
      </div>

      {error !== null ? <p className="auth-bar__error">{error}</p> : null}
    </section>
  );
}
