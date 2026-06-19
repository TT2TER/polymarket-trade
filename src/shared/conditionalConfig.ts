// #6 条件单 / OCO 离场策略的每仓配置。
// 一份配置含两条腿(OCO,二选一):
//   止盈腿 takeProfit:现价 ≥ takeProfitPrice 时,以 FAK 卖出 takeProfitFraction。
//   离场腿 stopExit:现价 ≤ stopExitPrice 时,以 FAK 卖出 stopExitFraction(缓跌离场,区别于止损的瞬时急跌)。
// 任一腿触发并提交后整张配置解除武装(One-Cancels-the-Other)。
// 仅面板开着时生效;遵守全局 dryRun;走与止损相同的自动卖出资金上限(stopLossMaxUsd)。

export interface ConditionalConfig {
  armed: boolean;
  takeProfitPrice: number | null; // 0~1
  takeProfitFraction: number | null; // 0~1
  stopExitPrice: number | null; // 0~1
  stopExitFraction: number | null; // 0~1
  slippage: number | null; // FAK 限价向下扫单容忍;null=用全局默认
}

export type ConditionalConfigs = Record<string, ConditionalConfig>;
export type ConditionalConfigPatch = Partial<Omit<ConditionalConfig, 'armed'>>;
export type ConditionalLeg = 'takeProfit' | 'stopExit';

const CONDITIONAL_CONFIGS_KEY = 'conditionalConfigs';

const DEFAULT_CONDITIONAL_CONFIG: ConditionalConfig = {
  armed: false,
  takeProfitPrice: null,
  takeProfitFraction: null,
  stopExitPrice: null,
  stopExitFraction: null,
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

export function normalizeConditionalConfig(value: Partial<ConditionalConfig> | undefined): ConditionalConfig {
  return {
    armed: typeof value?.armed === 'boolean' ? value.armed : DEFAULT_CONDITIONAL_CONFIG.armed,
    takeProfitPrice: clampNullableNumber(value?.takeProfitPrice, 0, 1),
    takeProfitFraction: clampNullableNumber(value?.takeProfitFraction, 0.05, 1),
    stopExitPrice: clampNullableNumber(value?.stopExitPrice, 0, 1),
    stopExitFraction: clampNullableNumber(value?.stopExitFraction, 0.05, 1),
    slippage: clampNullableNumber(value?.slippage, 0, 0.5),
  };
}

/** 止盈腿是否完整(价 + 比例都已设)。 */
export function hasTakeProfit(config: ConditionalConfig): boolean {
  return config.takeProfitPrice !== null && config.takeProfitFraction !== null;
}

/** 离场腿是否完整。 */
export function hasStopExit(config: ConditionalConfig): boolean {
  return config.stopExitPrice !== null && config.stopExitFraction !== null;
}

/** 是否至少有一条完整的腿(否则武装无意义)。 */
export function hasAnyLeg(config: ConditionalConfig): boolean {
  return hasTakeProfit(config) || hasStopExit(config);
}

function normalizeConditionalConfigs(value: unknown): ConditionalConfigs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const configs: ConditionalConfigs = {};
  for (const [asset, rawConfig] of Object.entries(value)) {
    if (typeof asset === 'string' && asset.trim().length > 0 && typeof rawConfig === 'object' && rawConfig !== null) {
      configs[asset] = normalizeConditionalConfig(rawConfig as Partial<ConditionalConfig>);
    }
  }
  return configs;
}

export async function readConditionalConfigs(): Promise<ConditionalConfigs> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(CONDITIONAL_CONFIGS_KEY, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(normalizeConditionalConfigs(items[CONDITIONAL_CONFIGS_KEY]));
    });
  });
}

export async function writeConditionalConfigs(configs: ConditionalConfigs): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [CONDITIONAL_CONFIGS_KEY]: normalizeConditionalConfigs(configs) }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}
