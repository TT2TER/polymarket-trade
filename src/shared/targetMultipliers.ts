/*
 * 每仓「目标倍数 N」的持久化(独立 storage key)。
 * ⚠ 故意不放进 AppConfig:setConfig 会触发 startMonitoring() 重连 WS,
 *    而 N 由滑块高频拖动产生,绝不能引发重连。这里单独存,且由 store 做 debounce 落盘。
 */

const KEY = 'targetMultipliers';

export type TargetMultipliers = Record<string, number>;

function sanitize(value: unknown): TargetMultipliers {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const out: TargetMultipliers = {};
  for (const [asset, n] of Object.entries(value as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      out[asset] = n;
    }
  }
  return out;
}

export async function readTargetMultipliers(): Promise<TargetMultipliers> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(KEY, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(sanitize(items[KEY]));
    });
  });
}

export async function writeTargetMultipliers(value: TargetMultipliers): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [KEY]: sanitize(value) }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}
