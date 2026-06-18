import type { Lang } from './i18n';

export type ThemeMode = 'system' | 'dark' | 'light';

export interface AppConfig {
  address: string;
  lang: Lang;
  theme: ThemeMode;
  hideSettled: boolean;
  positionsIntervalMs: number;
  booksIntervalMs: number;
  multipliers: number[];
  dryRun: boolean;
  maxOrderUsd: number;
  stopLossMaxUsd: number;
}

const CONFIG_KEY = 'appConfig';

export const DEFAULT_CONFIG: AppConfig = {
  address: '',
  lang: 'zh',
  theme: 'system',
  hideSettled: false,
  positionsIntervalMs: 15_000,
  booksIntervalMs: 5_000,
  multipliers: [2, 3, 5],
  dryRun: true,
  maxOrderUsd: 100,
  stopLossMaxUsd: 1000,
};

// 轮询间隔下限,防止 storage 被改成 0/负数/非有限值导致疯狂轮询打爆 API。
const MIN_POSITIONS_INTERVAL_MS = 5_000;
const MIN_BOOKS_INTERVAL_MS = 2_000;
const MIN_MAX_ORDER_USD = 0.01;

function clampInterval(value: unknown, min: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : Math.max(fallback, min);
}

function sanitizeMultipliers(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return DEFAULT_CONFIG.multipliers;
  }
  // 仅保留有限正数,去重并升序;为空则回退默认。
  const cleaned = [...new Set(value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0))].sort(
    (a, b) => a - b,
  );
  return cleaned.length > 0 ? cleaned : DEFAULT_CONFIG.multipliers;
}

function clampPositiveNumber(value: unknown, min: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(value, min) : fallback;
}

function normalizeLang(value: unknown): Lang {
  return value === 'zh' || value === 'en' ? value : DEFAULT_CONFIG.lang;
}

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light' ? value : DEFAULT_CONFIG.theme;
}

function normalizeConfig(value: Partial<AppConfig> | undefined): AppConfig {
  return {
    address: typeof value?.address === 'string' ? value.address : DEFAULT_CONFIG.address,
    lang: normalizeLang(value?.lang),
    theme: normalizeTheme(value?.theme),
    hideSettled: typeof value?.hideSettled === 'boolean' ? value.hideSettled : DEFAULT_CONFIG.hideSettled,
    positionsIntervalMs: clampInterval(
      value?.positionsIntervalMs,
      MIN_POSITIONS_INTERVAL_MS,
      DEFAULT_CONFIG.positionsIntervalMs,
    ),
    booksIntervalMs: clampInterval(value?.booksIntervalMs, MIN_BOOKS_INTERVAL_MS, DEFAULT_CONFIG.booksIntervalMs),
    multipliers: sanitizeMultipliers(value?.multipliers),
    dryRun: typeof value?.dryRun === 'boolean' ? value.dryRun : DEFAULT_CONFIG.dryRun,
    maxOrderUsd: clampPositiveNumber(value?.maxOrderUsd, MIN_MAX_ORDER_USD, DEFAULT_CONFIG.maxOrderUsd),
    stopLossMaxUsd: clampPositiveNumber(value?.stopLossMaxUsd, MIN_MAX_ORDER_USD, DEFAULT_CONFIG.stopLossMaxUsd),
  };
}

export async function readConfig(): Promise<AppConfig> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(CONFIG_KEY, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(normalizeConfig(items[CONFIG_KEY] as Partial<AppConfig> | undefined));
    });
  });
}

export async function writeConfig(config: AppConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [CONFIG_KEY]: normalizeConfig(config) }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}
