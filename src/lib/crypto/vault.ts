import type { EncryptedBlob } from './keyStore';

export interface SessionData {
  privateKey: string;
  // 签名者(Magic EOA)地址,公开信息,供 UI 显示核对;≠ funder/代理钱包。
  signerAddress?: string;
  creds?: {
    key: string;
    secret: string;
    passphrase: string;
  };
}

const ENCRYPTED_KEY_STORAGE_KEY = 'encryptedKey';
const SESSION_STORAGE_KEY = 'sessionData';

let sessionAccessConfigured = false;

function getLocalValue<T>(key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve((items[key] as T | undefined) ?? null);
    });
  });
}

function setLocalValue(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function removeLocalValue(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function getSessionValue<T>(key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(key, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve((items[key] as T | undefined) ?? null);
    });
  });
}

function setSessionValue(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function removeSessionValue(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.remove(key, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

async function ensureTrustedSessionAccess(): Promise<void> {
  if (sessionAccessConfigured) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      sessionAccessConfigured = true;
      resolve();
    });
  });
}

export async function saveEncryptedKey(blob: EncryptedBlob): Promise<void> {
  await setLocalValue(ENCRYPTED_KEY_STORAGE_KEY, blob);
}

export function loadEncryptedKey(): Promise<EncryptedBlob | null> {
  return getLocalValue<EncryptedBlob>(ENCRYPTED_KEY_STORAGE_KEY);
}

export async function hasEncryptedKey(): Promise<boolean> {
  return (await loadEncryptedKey()) !== null;
}

export function clearVault(): Promise<void> {
  return removeLocalValue(ENCRYPTED_KEY_STORAGE_KEY);
}

export async function cacheSession(data: SessionData): Promise<void> {
  await ensureTrustedSessionAccess();
  await setSessionValue(SESSION_STORAGE_KEY, data);
}

export function readSession(): Promise<SessionData | null> {
  return getSessionValue<SessionData>(SESSION_STORAGE_KEY);
}

export function clearSession(): Promise<void> {
  return removeSessionValue(SESSION_STORAGE_KEY);
}
