export interface StopLossConfig {
  armed: boolean;
  windowMs: number | null;
  threshold: number | null;
  sellFraction: number | null;
  // 每仓滑点容忍(0~0.5):止损卖单限价 = bestBid×(1−slippage);null = 用全局默认。
  slippage: number | null;
}

export type StopLossConfigs = Record<string, StopLossConfig>;

export type StopLossConfigPatch = Partial<Omit<StopLossConfig, 'armed'>>;

const STOP_LOSS_CONFIGS_KEY = 'stopLossConfigs';
const DEFAULT_STOP_LOSS_CONFIG: StopLossConfig = {
  armed: false,
  windowMs: null,
  threshold: null,
  sellFraction: null,
  slippage: null,
};

function clampNullableNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(max, Math.max(min, value));
}

export function normalizeStopLossConfig(value: Partial<StopLossConfig> | undefined): StopLossConfig {
  return {
    armed: typeof value?.armed === 'boolean' ? value.armed : DEFAULT_STOP_LOSS_CONFIG.armed,
    windowMs: clampNullableNumber(value?.windowMs, 1_000, 300_000),
    threshold: clampNullableNumber(value?.threshold, 0.01, 1),
    sellFraction: clampNullableNumber(value?.sellFraction, 0.05, 1),
    slippage: clampNullableNumber(value?.slippage, 0, 0.5),
  };
}

function normalizeStopLossConfigs(value: unknown): StopLossConfigs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const configs: StopLossConfigs = {};
  for (const [asset, rawConfig] of Object.entries(value)) {
    if (typeof asset === 'string' && asset.trim().length > 0 && typeof rawConfig === 'object' && rawConfig !== null) {
      configs[asset] = normalizeStopLossConfig(rawConfig as Partial<StopLossConfig>);
    }
  }

  return configs;
}

export async function readStopLossConfigs(): Promise<StopLossConfigs> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(STOP_LOSS_CONFIGS_KEY, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(normalizeStopLossConfigs(items[STOP_LOSS_CONFIGS_KEY]));
    });
  });
}

export async function writeStopLossConfigs(configs: StopLossConfigs): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STOP_LOSS_CONFIGS_KEY]: normalizeStopLossConfigs(configs) }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}
