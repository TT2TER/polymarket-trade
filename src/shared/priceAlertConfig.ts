// #3 到价提醒(被动通知,不自动交易)的每仓配置。
// 每仓一份配置,含若干可选阈值条件(任一为 null = 不启用该条件);enabled 总开关;repeat 决定一次性/重复。
// 价格用 0~1(与内部一致);pnlPct 为百分数(+20 表示 +20%);value 为 USD。

export interface PriceAlertConfig {
  enabled: boolean;
  /** 现价(可卖价)≥ X 时提醒。0~1。 */
  priceAbove: number | null;
  /** 现价 ≤ Y 时提醒。0~1。 */
  priceBelow: number | null;
  /** 未实现盈亏% ≥ X 时提醒。如 20 = +20%。 */
  pnlPctAbove: number | null;
  /** 未实现盈亏% ≤ Y 时提醒。如 -15 = −15%。 */
  pnlPctBelow: number | null;
  /** 持仓市值 ≥ X(USD)时提醒。 */
  valueAbove: number | null;
  /** true=条件每次重新满足都提醒;false(默认)=触发一次后该条件自动解除。 */
  repeat: boolean;
}

export type PriceAlertConfigs = Record<string, PriceAlertConfig>;

/** 可被监控评估的阈值条件键(不含 enabled/repeat)。 */
export const ALERT_CONDITION_KEYS = ['priceAbove', 'priceBelow', 'pnlPctAbove', 'pnlPctBelow', 'valueAbove'] as const;
export type AlertConditionKey = (typeof ALERT_CONDITION_KEYS)[number];

export type PriceAlertConfigPatch = Partial<PriceAlertConfig>;

const PRICE_ALERT_CONFIGS_KEY = 'priceAlertConfigs';

const DEFAULT_PRICE_ALERT_CONFIG: PriceAlertConfig = {
  enabled: false,
  priceAbove: null,
  priceBelow: null,
  pnlPctAbove: null,
  pnlPctBelow: null,
  valueAbove: null,
  repeat: false,
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

export function normalizePriceAlertConfig(value: Partial<PriceAlertConfig> | undefined): PriceAlertConfig {
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULT_PRICE_ALERT_CONFIG.enabled,
    priceAbove: clampNullableNumber(value?.priceAbove, 0, 1),
    priceBelow: clampNullableNumber(value?.priceBelow, 0, 1),
    pnlPctAbove: clampNullableNumber(value?.pnlPctAbove, -100, 100000),
    pnlPctBelow: clampNullableNumber(value?.pnlPctBelow, -100, 100000),
    valueAbove: clampNullableNumber(value?.valueAbove, 0, 100_000_000),
    repeat: typeof value?.repeat === 'boolean' ? value.repeat : DEFAULT_PRICE_ALERT_CONFIG.repeat,
  };
}

/** 配置是否含至少一个有效阈值条件(用于判断是否值得监控)。 */
export function hasAnyCondition(config: PriceAlertConfig): boolean {
  return ALERT_CONDITION_KEYS.some((key) => config[key] !== null);
}

function normalizePriceAlertConfigs(value: unknown): PriceAlertConfigs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const configs: PriceAlertConfigs = {};
  for (const [asset, rawConfig] of Object.entries(value)) {
    if (typeof asset === 'string' && asset.trim().length > 0 && typeof rawConfig === 'object' && rawConfig !== null) {
      configs[asset] = normalizePriceAlertConfig(rawConfig as Partial<PriceAlertConfig>);
    }
  }
  return configs;
}

export async function readPriceAlertConfigs(): Promise<PriceAlertConfigs> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(PRICE_ALERT_CONFIGS_KEY, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(normalizePriceAlertConfigs(items[PRICE_ALERT_CONFIGS_KEY]));
    });
  });
}

export async function writePriceAlertConfigs(configs: PriceAlertConfigs): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [PRICE_ALERT_CONFIGS_KEY]: normalizePriceAlertConfigs(configs) }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}
