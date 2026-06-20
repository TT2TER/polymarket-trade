import type { Lang } from './i18n';

export type ThemeMode = 'system' | 'dark' | 'light';
// 盈亏配色风格:cn = A 股(红涨绿跌);us = 美股(绿涨红跌)。
export type ColorStyle = 'cn' | 'us';

export interface AppConfig {
  address: string;
  lang: Lang;
  theme: ThemeMode;
  colorStyle: ColorStyle;
  hideSettled: boolean;
  showSummary: boolean;
  positionsIntervalMs: number;
  booksIntervalMs: number;
  multipliers: number[];
  dryRun: boolean;
  maxOrderUsd: number;
  stopLossMaxUsd: number;
  // #7 批量操作总额上限(一次批量所有腿预计金额之和不得超过);独立于单笔 maxOrderUsd。
  batchMaxUsd: number;
  // 止损卖单滑点容忍:FAK 限价 = bestBid×(1−slippage),向下扫单确保及时成交(0~0.5)。
  stopLossSlippage: number;
  // #2 已实现盈亏的「买入 taker 手续费」系数(Polymarket 2026 费率):
  //   fee = feeRate × 数量 × 价 × (1−价),仅对 buy taker 收取(卖单豁免、maker 免)。
  //   feeRate = 该品类每 100 股峰值费 / 25:体育 0.03 / 政治·金融·科技 0.04 / 加密 0.072 / 地缘事件 0。
  //   默认 0.03(体育=世界杯)。仅用于成交历史的成本基校正,不影响下单。
  takerFeeRate: number;
}

const CONFIG_KEY = 'appConfig';

export const DEFAULT_CONFIG: AppConfig = {
  address: '',
  lang: 'zh',
  theme: 'system',
  colorStyle: 'cn',
  hideSettled: false,
  showSummary: true,
  positionsIntervalMs: 15_000,
  booksIntervalMs: 5_000,
  multipliers: [2, 3, 5],
  // 存款钱包实盘已打通并验证,默认实盘交易(dryRun=false)。仍受二次确认 + maxOrderUsd 上限保护;可在设置随时切回模拟。
  dryRun: false,
  maxOrderUsd: 100,
  stopLossMaxUsd: 1000,
  batchMaxUsd: 2000,
  stopLossSlippage: 0.05,
  takerFeeRate: 0.03,
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

// 容忍 0(无滑点)的比例字段:落在 [min,max] 用之,否则回退默认。
function clampFraction(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function normalizeLang(value: unknown): Lang {
  return value === 'zh' || value === 'en' ? value : DEFAULT_CONFIG.lang;
}

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light' ? value : DEFAULT_CONFIG.theme;
}

function normalizeColorStyle(value: unknown): ColorStyle {
  return value === 'cn' || value === 'us' ? value : DEFAULT_CONFIG.colorStyle;
}

function normalizeConfig(value: Partial<AppConfig> | undefined): AppConfig {
  return {
    address: typeof value?.address === 'string' ? value.address : DEFAULT_CONFIG.address,
    lang: normalizeLang(value?.lang),
    theme: normalizeTheme(value?.theme),
    colorStyle: normalizeColorStyle(value?.colorStyle),
    hideSettled: typeof value?.hideSettled === 'boolean' ? value.hideSettled : DEFAULT_CONFIG.hideSettled,
    showSummary: typeof value?.showSummary === 'boolean' ? value.showSummary : DEFAULT_CONFIG.showSummary,
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
    batchMaxUsd: clampPositiveNumber(value?.batchMaxUsd, MIN_MAX_ORDER_USD, DEFAULT_CONFIG.batchMaxUsd),
    stopLossSlippage: clampFraction(value?.stopLossSlippage, 0, 0.5, DEFAULT_CONFIG.stopLossSlippage),
    takerFeeRate: clampFraction(value?.takerFeeRate, 0, 0.2, DEFAULT_CONFIG.takerFeeRate),
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
