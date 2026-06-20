export type StopLossThresholdMode = 'fixed' | 'adaptive';
export type StopLossAnchor = 'peak' | 'cost' | 'activated-trailing';

export interface StopLossConfig {
  armed: boolean;
  refK: number | null;
  thresholdMode: StopLossThresholdMode | null;
  baseThreshold: number | null;
  anchor: StopLossAnchor | null;
  activateProfitPct: number | null;
  minAbsCushion: number | null;
  breakevenFloor: boolean | null;
  maxLossPct: number | null;
  sellFraction: number | null;
  dwellMs: number | null;
  requireTradeConfirm: boolean | null;
  lowPriceFloor: number | null;
  cataAbsDrop: number | null;
  cataAbsMult: number | null;
  cooldownMs: number | null;
  slippage: number | null;
  scaledExit: boolean | null;
  semiAutoMode: boolean | null;
  // Legacy aliases kept for the current non-refactored UI components.
  windowMs: number | null;
  threshold: number | null;
}

export interface StopLossDefaults {
  refK: number;
  thresholdMode: StopLossThresholdMode;
  baseThreshold: number;
  anchor: StopLossAnchor;
  activateProfitPct: number;
  minAbsCushion: number;
  breakevenFloor: boolean;
  maxLossPct: number;
  sellFraction: number;
  dwellMs: number;
  requireTradeConfirm: boolean;
  lowPriceFloor: number;
  cataAbsDrop: number;
  cataAbsMult: number;
  cooldownMs: number;
  slippage: number | null;
  scaledExit: boolean;
  semiAutoMode: boolean;
}

export interface ResolvedStopLossConfig extends StopLossDefaults {
  armed: boolean;
}

export type StopLossConfigs = Record<string, StopLossConfig>;
export type StopLossConfigPatch = Partial<Omit<StopLossConfig, 'armed'>>;

const STOP_LOSS_CONFIGS_KEY = 'stopLossConfigs';
const STOP_LOSS_DEFAULTS_KEY = 'stopLossDefaults';

export const DEFAULT_STOP_LOSS_DEFAULTS: StopLossDefaults = {
  refK: 5,
  thresholdMode: 'adaptive',
  baseThreshold: 0.05,
  anchor: 'activated-trailing',
  activateProfitPct: 0.12,
  minAbsCushion: 0.04,
  breakevenFloor: true,
  maxLossPct: 0.25,
  sellFraction: 0.6,
  dwellMs: 4_000,
  requireTradeConfirm: true,
  lowPriceFloor: 0.1,
  cataAbsDrop: 0.03,
  cataAbsMult: 0.5,
  cooldownMs: 60_000,
  slippage: 0.05,
  scaledExit: true,
  semiAutoMode: false,
};

const DEFAULT_STOP_LOSS_CONFIG: StopLossConfig = {
  armed: false,
  refK: null,
  thresholdMode: null,
  baseThreshold: null,
  anchor: null,
  activateProfitPct: null,
  minAbsCushion: null,
  breakevenFloor: null,
  maxLossPct: null,
  sellFraction: null,
  dwellMs: null,
  requireTradeConfirm: null,
  lowPriceFloor: null,
  cataAbsDrop: null,
  cataAbsMult: null,
  cooldownMs: null,
  slippage: null,
  scaledExit: null,
  semiAutoMode: null,
  windowMs: null,
  threshold: null,
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

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function booleanWithDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function thresholdMode(value: unknown): StopLossThresholdMode | null {
  return value === 'fixed' || value === 'adaptive' ? value : null;
}

function anchor(value: unknown): StopLossAnchor | null {
  return value === 'peak' || value === 'cost' || value === 'activated-trailing' ? value : null;
}

function normalizeStopLossDefaults(value: Partial<StopLossDefaults> | undefined): StopLossDefaults {
  return {
    refK: Math.round(clampNumber(value?.refK, DEFAULT_STOP_LOSS_DEFAULTS.refK, 1, 25)),
    thresholdMode: thresholdMode(value?.thresholdMode) ?? DEFAULT_STOP_LOSS_DEFAULTS.thresholdMode,
    baseThreshold: clampNumber(value?.baseThreshold, DEFAULT_STOP_LOSS_DEFAULTS.baseThreshold, 0.01, 1),
    anchor: anchor(value?.anchor) ?? DEFAULT_STOP_LOSS_DEFAULTS.anchor,
    activateProfitPct: clampNumber(value?.activateProfitPct, DEFAULT_STOP_LOSS_DEFAULTS.activateProfitPct, 0, 5),
    minAbsCushion: clampNumber(value?.minAbsCushion, DEFAULT_STOP_LOSS_DEFAULTS.minAbsCushion, 0, 1),
    breakevenFloor: booleanWithDefault(value?.breakevenFloor, DEFAULT_STOP_LOSS_DEFAULTS.breakevenFloor),
    maxLossPct: clampNumber(value?.maxLossPct, DEFAULT_STOP_LOSS_DEFAULTS.maxLossPct, 0.01, 1),
    sellFraction: clampNumber(value?.sellFraction, DEFAULT_STOP_LOSS_DEFAULTS.sellFraction, 0.05, 1),
    dwellMs: Math.round(clampNumber(value?.dwellMs, DEFAULT_STOP_LOSS_DEFAULTS.dwellMs, 0, 300_000)),
    requireTradeConfirm: booleanWithDefault(value?.requireTradeConfirm, DEFAULT_STOP_LOSS_DEFAULTS.requireTradeConfirm),
    lowPriceFloor: clampNumber(value?.lowPriceFloor, DEFAULT_STOP_LOSS_DEFAULTS.lowPriceFloor, 0, 1),
    cataAbsDrop: clampNumber(value?.cataAbsDrop, DEFAULT_STOP_LOSS_DEFAULTS.cataAbsDrop, 0, 1),
    cataAbsMult: clampNumber(value?.cataAbsMult, DEFAULT_STOP_LOSS_DEFAULTS.cataAbsMult, 0, 1),
    cooldownMs: Math.round(clampNumber(value?.cooldownMs, DEFAULT_STOP_LOSS_DEFAULTS.cooldownMs, 0, 600_000)),
    slippage:
      value?.slippage === null
        ? null
        : clampNumber(value?.slippage, DEFAULT_STOP_LOSS_DEFAULTS.slippage ?? 0.05, 0, 0.5),
    scaledExit: booleanWithDefault(value?.scaledExit, DEFAULT_STOP_LOSS_DEFAULTS.scaledExit),
    semiAutoMode: booleanWithDefault(value?.semiAutoMode, DEFAULT_STOP_LOSS_DEFAULTS.semiAutoMode),
  };
}

export function normalizeStopLossConfig(value: Partial<StopLossConfig> | undefined): StopLossConfig {
  return {
    armed: typeof value?.armed === 'boolean' ? value.armed : DEFAULT_STOP_LOSS_CONFIG.armed,
    refK: clampNullableNumber(value?.refK, 1, 25),
    thresholdMode: thresholdMode(value?.thresholdMode),
    baseThreshold: clampNullableNumber(value?.baseThreshold, 0.01, 1),
    anchor: anchor(value?.anchor),
    activateProfitPct: clampNullableNumber(value?.activateProfitPct, 0, 5),
    minAbsCushion: clampNullableNumber(value?.minAbsCushion, 0, 1),
    breakevenFloor: nullableBoolean(value?.breakevenFloor),
    maxLossPct: clampNullableNumber(value?.maxLossPct, 0.01, 1),
    sellFraction: clampNullableNumber(value?.sellFraction, 0.05, 1),
    dwellMs: clampNullableNumber(value?.dwellMs, 0, 300_000),
    requireTradeConfirm: nullableBoolean(value?.requireTradeConfirm),
    lowPriceFloor: clampNullableNumber(value?.lowPriceFloor, 0, 1),
    cataAbsDrop: clampNullableNumber(value?.cataAbsDrop, 0, 1),
    cataAbsMult: clampNullableNumber(value?.cataAbsMult, 0, 1),
    cooldownMs: clampNullableNumber(value?.cooldownMs, 0, 600_000),
    slippage: clampNullableNumber(value?.slippage, 0, 0.5),
    scaledExit: nullableBoolean(value?.scaledExit),
    semiAutoMode: nullableBoolean(value?.semiAutoMode),
    windowMs: clampNullableNumber(value?.windowMs, 1_000, 300_000),
    threshold: clampNullableNumber(value?.threshold, 0.01, 1),
  };
}

export function resolveStopLossConfig(
  config: Partial<StopLossConfig> | undefined,
  defaults: Partial<StopLossDefaults> = DEFAULT_STOP_LOSS_DEFAULTS,
): ResolvedStopLossConfig {
  const normalized = normalizeStopLossConfig(config);
  const resolvedDefaults = normalizeStopLossDefaults(defaults);

  return {
    armed: normalized.armed,
    refK: Math.round(normalized.refK ?? resolvedDefaults.refK),
    thresholdMode: normalized.thresholdMode ?? resolvedDefaults.thresholdMode,
    baseThreshold: normalized.baseThreshold ?? normalized.threshold ?? resolvedDefaults.baseThreshold,
    anchor: normalized.anchor ?? resolvedDefaults.anchor,
    activateProfitPct: normalized.activateProfitPct ?? resolvedDefaults.activateProfitPct,
    minAbsCushion: normalized.minAbsCushion ?? resolvedDefaults.minAbsCushion,
    breakevenFloor: normalized.breakevenFloor ?? resolvedDefaults.breakevenFloor,
    maxLossPct: normalized.maxLossPct ?? resolvedDefaults.maxLossPct,
    sellFraction: normalized.sellFraction ?? resolvedDefaults.sellFraction,
    dwellMs: Math.round(normalized.dwellMs ?? normalized.windowMs ?? resolvedDefaults.dwellMs),
    requireTradeConfirm: normalized.requireTradeConfirm ?? resolvedDefaults.requireTradeConfirm,
    lowPriceFloor: normalized.lowPriceFloor ?? resolvedDefaults.lowPriceFloor,
    cataAbsDrop: normalized.cataAbsDrop ?? resolvedDefaults.cataAbsDrop,
    cataAbsMult: normalized.cataAbsMult ?? resolvedDefaults.cataAbsMult,
    cooldownMs: Math.round(normalized.cooldownMs ?? resolvedDefaults.cooldownMs),
    slippage: normalized.slippage ?? resolvedDefaults.slippage,
    scaledExit: normalized.scaledExit ?? resolvedDefaults.scaledExit,
    semiAutoMode: normalized.semiAutoMode ?? resolvedDefaults.semiAutoMode,
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

export async function readStopLossDefaults(): Promise<StopLossDefaults> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(STOP_LOSS_DEFAULTS_KEY, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(normalizeStopLossDefaults(items[STOP_LOSS_DEFAULTS_KEY] as Partial<StopLossDefaults> | undefined));
    });
  });
}

export async function writeStopLossDefaults(defaults: StopLossDefaults): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STOP_LOSS_DEFAULTS_KEY]: normalizeStopLossDefaults(defaults) }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}
