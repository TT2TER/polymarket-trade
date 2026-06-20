import { create } from 'zustand';
import type { OpenOrder } from '@polymarket/clob-client-v2';
import type { DataSource, Snapshot } from '@/lib/datasource/types';
import { roundDownShares, type PlaceSellResult } from '@/lib/trading/orders';
import { StopLossMonitor, type StopLossMonitorStatuses, type StopLossTriggerDetails } from '@/lib/stoploss/monitor';
import { AlertMonitor, type AlertTrigger } from '@/lib/alerts/alertMonitor';
import { ConditionalMonitor, type ConditionalTriggerDetails } from '@/lib/conditional/conditionalMonitor';
import { WsSource } from '@/lib/datasource/wsSource';
import { getTodayPnl } from '@/lib/api/userPnl';
import { getActivity } from '@/lib/api/tradesApi';
import { computeTradeHistory, type FeeResolver, type TradeHistory } from '@/lib/calc/tradeHistory';
import { getMarketMeta, type MarketMeta } from '@/lib/api/gammaApi';
import { samplePriceHistory, type PriceHistory } from '@/lib/calc/priceHistory';
import { DEFAULT_CONFIG, readConfig, writeConfig, type AppConfig } from '@/shared/config';
import { translate, type I18nKey } from '@/shared/i18n';
import {
  DEFAULT_STOP_LOSS_DEFAULTS,
  normalizeStopLossConfig,
  readStopLossConfigs,
  readStopLossDefaults,
  resolveStopLossConfig,
  writeStopLossConfigs,
  writeStopLossDefaults,
  type StopLossConfigPatch,
  type StopLossConfigs,
  type StopLossDefaults,
} from '@/shared/stopLossConfig';
import { readTargetMultipliers, writeTargetMultipliers, type TargetMultipliers } from '@/shared/targetMultipliers';
import {
  normalizeConditionalConfig,
  readConditionalConfigs,
  writeConditionalConfigs,
  type ConditionalConfigPatch,
  type ConditionalConfigs,
} from '@/shared/conditionalConfig';
import {
  hasAnyCondition,
  normalizePriceAlertConfig,
  readPriceAlertConfigs,
  writePriceAlertConfigs,
  type AlertConditionKey,
  type PriceAlertConfigPatch,
  type PriceAlertConfigs,
} from '@/shared/priceAlertConfig';
import type {
  AuthStatusResponse,
  ErrorResponse,
  GetOpenOrdersOkResponse,
  OkResponse,
  OrderPreview,
  PlaceOrderOkResponse,
  PrepareOrderOkResponse,
  PrepareOrderRequest,
  RuntimeMessage,
  TradingOkResponse,
} from '@/shared/messages';

type AuthStatus = AuthStatusResponse;

type AuthResponse = AuthStatusResponse | OkResponse | ErrorResponse;

interface MonitorStore {
  config: AppConfig;
  stopLossConfigs: StopLossConfigs;
  // 全局止损默认值:per-position 未覆盖的字段回落到这里(由 resolveStopLossConfig 合并)。
  stopLossDefaults: StopLossDefaults;
  stopLossStatuses: StopLossStatuses;
  // Phase 2b 半自动:待人工确认的止损触发(semiAutoMode 开启的仓触发时进此队列,而非直接下单)。
  pendingStopLoss: Record<string, PendingStopLoss>;
  // #3 到价提醒:每仓阈值配置(被动通知,不下单)。
  priceAlertConfigs: PriceAlertConfigs;
  // #6 条件单/OCO:每仓离场策略配置 + 触发状态。
  conditionalConfigs: ConditionalConfigs;
  conditionalStatuses: ConditionalStatuses;
  targetMultipliers: TargetMultipliers;
  todayPnl: number | null;
  // #2 成交历史 + 已实现盈亏(data-api/trades 真实成交,平均成本法回放);on-demand 拉取。
  tradeHistory: TradeHistory | null;
  tradesLoading: boolean;
  tradesError: string | null;
  snapshot: Snapshot | null;
  // #1 价格走势:每个 asset 的内存级价格序列(关面板即清),由行情合帧回调采样。
  priceHistory: PriceHistory;
  // #4 封盘倒计时:每个 conditionId 的市场元数据(gamma 低频拉取的封盘时间)。
  marketMeta: Record<string, MarketMeta>;
  openOrders: Record<string, OpenOrder[]>;
  orderErrors: Record<string, string | null>;
  isLoading: boolean;
  isTrading: boolean;
  authStatus: AuthStatus;
  setConfig: (config: AppConfig) => Promise<void>;
  loadConfig: () => Promise<void>;
  loadStopLossConfigs: () => Promise<void>;
  setStopLossDefaults: (defaults: StopLossDefaults) => Promise<void>;
  loadPriceAlertConfigs: () => Promise<void>;
  setPriceAlert: (asset: string, patch: PriceAlertConfigPatch) => Promise<void>;
  clearAlertCondition: (asset: string, key: AlertConditionKey) => Promise<void>;
  loadConditionalConfigs: () => Promise<void>;
  armConditional: (asset: string, params?: ConditionalConfigPatch) => Promise<void>;
  disarmConditional: (asset: string) => Promise<void>;
  setConditionalParams: (asset: string, params: ConditionalConfigPatch) => Promise<void>;
  executeConditional: (asset: string, details: ConditionalTriggerDetails) => Promise<void>;
  loadTargetMultipliers: () => Promise<void>;
  setTargetMultiplier: (asset: string, n: number) => void;
  fetchMarketMeta: (conditionIds: string[]) => Promise<void>;
  fetchTodayPnl: () => Promise<void>;
  fetchTrades: () => Promise<void>;
  armStopLoss: (asset: string, params?: StopLossConfigPatch) => Promise<void>;
  disarmStopLoss: (asset: string) => Promise<void>;
  setStopLossParams: (asset: string, params: StopLossConfigPatch) => Promise<void>;
  executeStopLoss: (asset: string, details: StopLossTriggerDetails) => Promise<void>;
  // Phase 2b 半自动确认流:触发→入队(弹卡片+通知+倒计时);确认/超时→执行;取消→丢弃。
  requestStopLossConfirm: (asset: string, details: StopLossTriggerDetails) => void;
  confirmStopLoss: (asset: string) => void;
  cancelStopLoss: (asset: string) => void;
  startMonitoring: () => void;
  stopMonitoring: () => void;
  refresh: () => void;
  refreshAuthStatus: () => Promise<void>;
  importKey: (privateKey: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  forgetKey: () => Promise<void>;
  prepareOrder: (payload: Omit<PrepareOrderRequest, 'type'>) => Promise<{ nonce: string; preview: OrderPreview }>;
  confirmOrder: (nonce: string, tokenID: string) => Promise<PlaceSellResult>;
  getOpenOrders: (asset: string) => Promise<OpenOrder[]>;
  cancelOrder: (asset: string, orderID: string) => Promise<void>;
  cancelAll: (asset: string) => Promise<void>;
}

export interface StopLossStatus {
  drop: number;
  threshold: number;
  sellFraction: number;
  cooldownUntil: number;
  priceNow: number;
  ref: number;
  cost: number;
  peak: number;
  exitLine: number;
  regime: 'loss-floor' | 'trailing' | 'breakeven' | 'lowprice';
  activated: boolean;
  breach: boolean;
  dwellMs: number;
  dwellRemainingMs: number;
  lastTriggeredAt: number;
  lastResult: string | null;
  lastError: string | null;
}

export type StopLossStatuses = Record<string, StopLossStatus>;

export interface PendingStopLoss {
  asset: string;
  title: string;
  details: StopLossTriggerDetails;
  qty: number;
  deadline: number;
}

export interface ConditionalStatus {
  lastTriggeredAt: number;
  lastResult: string | null;
  lastError: string | null;
}

export type ConditionalStatuses = Record<string, ConditionalStatus>;

let activeSource: DataSource | null = null;
let activeUnsubscribe: (() => void) | null = null;
let activeStopLossMonitor: StopLossMonitor | null = null;
let activeAlertMonitor: AlertMonitor | null = null;
let activeConditionalMonitor: ConditionalMonitor | null = null;
let monitoringActive = false;
// 目标倍数 N 的 debounce 落盘计时器(拖动停止 ~500ms 后写一次,不打爆 storage)。
let targetMultipliersTimer: ReturnType<typeof setTimeout> | null = null;
// #4 封盘元数据:已请求(成功或在途)的 conditionId,避免行情每帧重复拉 gamma;startMonitoring 时清空。
const requestedConditionIds = new Set<string>();
// 监控代次:每次 startMonitoring +1。在途 gamma 请求返回时凭它丢弃旧会话结果(防 marketMeta 被 stale 覆盖)。
let monitorGeneration = 0;
// gamma 拉取失败后的退避时点:避免失败 id 被移出集合后在每个行情帧紧密重试。
let metaRetryAfter = 0;
// #6 条件单提交失败后重试退避(避免拒单时每帧重触发);模拟成功后的重测间隔。
const CONDITIONAL_RETRY_MS = 15_000;
const CONDITIONAL_DRYRUN_RETEST_MS = 30_000;
// Phase 2b 半自动确认倒计时;超时按 fail-safe 自动执行(不取消)。
const SEMI_AUTO_TTL_MS = 10_000;
// 取消半自动确认 = snooze:持续破位在此退避后重新弹确认,而非永久静默(M1)。
const SEMI_AUTO_SNOOZE_MS = 30_000;
// 止损下单失败/零成交后的重试退避:清冷却后让持续破位的仓在此时长后可再次触发。
const STOPLOSS_RETRY_MS = 15_000;
const semiAutoTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearSemiAutoTimer(asset: string): void {
  const timer = semiAutoTimers.get(asset);
  if (timer) {
    clearTimeout(timer);
    semiAutoTimers.delete(asset);
  }
}

function stopActiveSource(): void {
  activeUnsubscribe?.();
  activeUnsubscribe = null;
  activeSource?.stop();
  activeSource = null;
  activeStopLossMonitor?.reset();
  activeStopLossMonitor = null;
  activeAlertMonitor?.reset();
  activeAlertMonitor = null;
  activeConditionalMonitor?.reset();
  activeConditionalMonitor = null;
}

function errorSnapshot(message: string): Snapshot {
  return {
    positions: [],
    books: {},
    lastUpdated: Date.now(),
    error: message,
  };
}

function sendRuntimeMessage<TResponse>(message: RuntimeMessage): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TResponse | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (response === undefined) {
        reject(new Error('No response from background service worker.'));
        return;
      }

      resolve(response);
    });
  });
}

function assertOk(response: AuthResponse): void {
  if ('error' in response) {
    throw new Error(response.error);
  }
}

function patchStopLossStatus(
  statuses: StopLossStatuses,
  asset: string,
  patch: Partial<StopLossStatus>,
): StopLossStatuses {
  const previous = statuses[asset];
  return {
    ...statuses,
    [asset]: {
      drop: previous?.drop ?? 0,
      threshold: previous?.threshold ?? 0,
      sellFraction: previous?.sellFraction ?? 0,
      cooldownUntil: previous?.cooldownUntil ?? 0,
      priceNow: previous?.priceNow ?? 0,
      ref: previous?.ref ?? 0,
      cost: previous?.cost ?? 0,
      peak: previous?.peak ?? 0,
      exitLine: previous?.exitLine ?? 0,
      regime: previous?.regime ?? 'loss-floor',
      activated: previous?.activated ?? false,
      breach: previous?.breach ?? false,
      dwellMs: previous?.dwellMs ?? 0,
      dwellRemainingMs: previous?.dwellRemainingMs ?? 0,
      lastTriggeredAt: previous?.lastTriggeredAt ?? 0,
      lastResult: previous?.lastResult ?? null,
      lastError: previous?.lastError ?? null,
      ...patch,
    },
  };
}

function mergeMonitorStatuses(statuses: StopLossStatuses, monitorStatuses: StopLossMonitorStatuses): StopLossStatuses {
  let next = statuses;
  for (const [asset, status] of Object.entries(monitorStatuses)) {
    next = patchStopLossStatus(next, asset, status);
  }
  return next;
}

function notifyDesktop(title: string, message: string): void {
  chrome.notifications.create({
    type: 'basic',
    iconUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVR42mNk+M9Qz0AEYBxVSFUBABYSEhH8q7AfAAAAAElFTkSuQmCC',
    title,
    message,
  });
}

// #3 到价提醒触发文案:把条件键 + 阈值格式化为「价 ≥ 75¢ / 盈亏 ≥ +20% / 市值 ≥ $300」。
function describeAlertCondition(lang: AppConfig['lang'], key: AlertConditionKey, threshold: number): string {
  const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`;
  switch (key) {
    case 'priceAbove':
      return translate(lang, 'alert.condPriceAbove', { v: Math.round(threshold * 100) });
    case 'priceBelow':
      return translate(lang, 'alert.condPriceBelow', { v: Math.round(threshold * 100) });
    case 'pnlPctAbove':
      return translate(lang, 'alert.condPnlAbove', { v: signed(threshold) });
    case 'pnlPctBelow':
      return translate(lang, 'alert.condPnlBelow', { v: signed(threshold) });
    case 'valueAbove':
      return translate(lang, 'alert.condValueAbove', { v: Math.round(threshold) });
  }
}

// #3 触发处理:桌面通知 + 一次性触发后清除该阈值并持久化(再无条件则关 enabled)。
async function handleAlertTrigger(get: () => MonitorStore, trigger: AlertTrigger): Promise<void> {
  const lang = get().config.lang;
  const condText = describeAlertCondition(lang, trigger.conditionKey, trigger.threshold);
  notifyDesktop(translate(lang, 'alert.firedTitle'), `${trigger.title} · ${trigger.outcome.toUpperCase()} · ${condText}`);

  if (!trigger.oneShot) {
    return;
  }
  await get().clearAlertCondition(trigger.asset, trigger.conditionKey);
}

const monitorStore = create<MonitorStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  stopLossConfigs: {},
  stopLossDefaults: DEFAULT_STOP_LOSS_DEFAULTS,
  stopLossStatuses: {},
  pendingStopLoss: {},
  priceAlertConfigs: {},
  conditionalConfigs: {},
  conditionalStatuses: {},
  targetMultipliers: {},
  todayPnl: null,
  tradeHistory: null,
  tradesLoading: false,
  tradesError: null,
  snapshot: null,
  priceHistory: {},
  marketMeta: {},
  openOrders: {},
  orderErrors: {},
  isLoading: false,
  isTrading: false,
  authStatus: { hasKey: false, unlocked: false, authenticated: false },

  setConfig: async (config: AppConfig) => {
    await writeConfig(config);
    set({ config });

    if (monitoringActive) {
      get().startMonitoring();
    }
  },

  loadConfig: async () => {
    try {
      const config = await readConfig();
      set({ config });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ snapshot: errorSnapshot(translate(get().config.lang, 'app.configLoadFailed', { message })), isLoading: false });
    }
  },

  loadStopLossConfigs: async () => {
    try {
      const [configs, defaults] = await Promise.all([readStopLossConfigs(), readStopLossDefaults()]);
      set({ stopLossConfigs: configs, stopLossDefaults: defaults });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        snapshot: errorSnapshot(translate(get().config.lang, 'stopLoss.configLoadFailed', { message })),
        isLoading: false,
      });
    }
  },

  setStopLossDefaults: async (defaults: StopLossDefaults) => {
    await writeStopLossDefaults(defaults);
    set({ stopLossDefaults: defaults });
  },

  loadPriceAlertConfigs: async () => {
    try {
      set({ priceAlertConfigs: await readPriceAlertConfigs() });
    } catch {
      // 非关键偏好,读失败用空映射(各仓无提醒)。
      set({ priceAlertConfigs: {} });
    }
  },

  // 设置/更新某仓的到价提醒配置并持久化。patch 合并入既有配置后规范化。
  setPriceAlert: async (asset: string, patch: PriceAlertConfigPatch) => {
    const current = get().priceAlertConfigs[asset];
    const nextConfig = normalizePriceAlertConfig({ ...current, ...patch });
    const nextConfigs = { ...get().priceAlertConfigs, [asset]: nextConfig };
    await writePriceAlertConfigs(nextConfigs);
    set({ priceAlertConfigs: nextConfigs });
  },

  // 一次性触发后清除该阈值(再无条件则关 enabled)。用函数式 set 原子合并 + 持久化最新整体状态,
  // 使同一帧多个一次性触发并发清除时互不覆盖(各自 await 时都读 get() 最新全量,写入相同终态)。
  clearAlertCondition: async (asset: string, key: AlertConditionKey) => {
    set((state) => {
      const current = state.priceAlertConfigs[asset];
      if (!current) {
        return {};
      }
      const projected = normalizePriceAlertConfig({ ...current, [key]: null });
      if (!hasAnyCondition(projected)) {
        projected.enabled = false;
      }
      return { priceAlertConfigs: { ...state.priceAlertConfigs, [asset]: projected } };
    });
    await writePriceAlertConfigs(get().priceAlertConfigs);
  },

  loadConditionalConfigs: async () => {
    try {
      set({ conditionalConfigs: await readConditionalConfigs() });
    } catch {
      set({ conditionalConfigs: {} });
    }
  },

  armConditional: async (asset: string, params: ConditionalConfigPatch = {}) => {
    const current = get().conditionalConfigs[asset];
    const nextConfig = normalizeConditionalConfig({ ...current, ...params, armed: true });
    const nextConfigs = { ...get().conditionalConfigs, [asset]: nextConfig };
    await writeConditionalConfigs(nextConfigs);
    set({ conditionalConfigs: nextConfigs });
  },

  disarmConditional: async (asset: string) => {
    const current = get().conditionalConfigs[asset];
    const nextConfig = normalizeConditionalConfig({ ...current, armed: false });
    const nextConfigs = { ...get().conditionalConfigs, [asset]: nextConfig };
    await writeConditionalConfigs(nextConfigs);
    activeConditionalMonitor?.removeAsset(asset);
    set({ conditionalConfigs: nextConfigs });
  },

  setConditionalParams: async (asset: string, params: ConditionalConfigPatch) => {
    const current = get().conditionalConfigs[asset];
    const nextConfig = normalizeConditionalConfig({ ...current, ...params });
    const nextConfigs = { ...get().conditionalConfigs, [asset]: nextConfig };
    await writeConditionalConfigs(nextConfigs);
    set({ conditionalConfigs: nextConfigs });
  },

  // #6 条件单触发执行:与止损同走后台 CONDITIONAL_SELL(taker FAK + 资金上限 + 冷却 + dryRun)。
  // 真实成交后解除武装(OCO:取消另一腿);dry-run 保持武装便于测试(monitor firedOnce 防重复)。
  executeConditional: async (asset: string, details: ConditionalTriggerDetails) => {
    const t = (key: I18nKey, params?: Record<string, string | number>) => translate(get().config.lang, key, params);
    const legLabel = details.leg === 'takeProfit' ? t('cond.legTakeProfit') : t('cond.legStopExit');
    const position = get().snapshot?.positions.find((item) => item.asset === asset);
    const positionSize = position?.size ?? details.sizeNow;
    const qty = roundDownShares(details.fraction * details.sizeNow);
    const formattedQty = qty.toLocaleString(undefined, { maximumFractionDigits: 2 });

    const setStatus = (patch: Partial<ConditionalStatus>) =>
      set((state) => ({
        conditionalStatuses: {
          ...state.conditionalStatuses,
          [asset]: {
            lastTriggeredAt: state.conditionalStatuses[asset]?.lastTriggeredAt ?? 0,
            lastResult: state.conditionalStatuses[asset]?.lastResult ?? null,
            lastError: state.conditionalStatuses[asset]?.lastError ?? null,
            ...patch,
          },
        },
      }));

    setStatus({ lastTriggeredAt: Date.now(), lastResult: t('cond.submitting', { leg: legLabel, qty: formattedQty }), lastError: null });

    if (!position || !Number.isFinite(qty) || qty <= 0) {
      const message = !position ? t('stopLoss.positionGone') : t('stopLoss.invalidQuantity');
      setStatus({ lastResult: null, lastError: message });
      notifyDesktop(t('cond.failedTitle'), message);
      return;
    }

    try {
      const response = await sendRuntimeMessage<PlaceOrderOkResponse | ErrorResponse>({
        type: 'CONDITIONAL_SELL',
        tokenID: asset,
        qty,
        bestBid: details.priceNow,
        negRisk: position.negativeRisk,
        avgPrice: position.avgPrice,
        positionSize,
      });
      if ('error' in response) {
        throw new Error(response.error);
      }
      const result = response.data;
      const params = {
        leg: legLabel,
        size: result.size.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        price: result.price.toFixed(4),
      };
      const message = result.dryRun ? t('cond.resultDryRun', params) : t('cond.resultSubmitted', params);
      setStatus({ lastResult: message, lastError: null });
      notifyDesktop(result.dryRun ? t('cond.dryRunTitle') : t('cond.submittedTitle'), message);

      if (result.dryRun) {
        // 模拟成功:不解除武装,设退避便于反复测试(模拟不动真钱,可安全重触发)。
        activeConditionalMonitor?.settle(asset, CONDITIONAL_DRYRUN_RETEST_MS);
        return;
      }
      // OCO:仅在有实际成交量时才解除武装(取消另一腿);零/未知成交不解除、也不解除 blocked
      //(保持静默以防同腿重复卖出——比误取消另一腿保护更安全)。
      const num = (raw?: string): number => {
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
      };
      const filled = num(result.makingAmount) > 0 || num(result.takingAmount) > 0;
      if (filled) {
        await get().disarmConditional(asset);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ lastResult: null, lastError: message });
      notifyDesktop(t('cond.failedTitle'), message);
      // 提交失败(拒单/上限/冷却/网络):未发生卖出,解除 blocked 并退避,使条件单不被静默禁用。
      activeConditionalMonitor?.settle(asset, CONDITIONAL_RETRY_MS);
    }
  },

  loadTargetMultipliers: async () => {
    try {
      set({ targetMultipliers: await readTargetMultipliers() });
    } catch {
      // 非关键偏好,读失败就用空映射(各仓回退默认倍数)。
      set({ targetMultipliers: {} });
    }
  },

  // 每仓目标倍数:即时更新内存(供进度条/滑块实时联动),debounce 落盘。绝不走 setConfig(不重连 WS)。
  setTargetMultiplier: (asset: string, n: number) => {
    if (!Number.isFinite(n) || n <= 0) {
      return;
    }
    set((state) => ({ targetMultipliers: { ...state.targetMultipliers, [asset]: n } }));
    if (targetMultipliersTimer) {
      clearTimeout(targetMultipliersTimer);
    }
    targetMultipliersTimer = setTimeout(() => {
      void writeTargetMultipliers(get().targetMultipliers);
    }, 500);
  },

  // #4 封盘元数据:对尚未请求过的 conditionId 低频拉一次 gamma(gameStartTime||endDate)。
  // 失败的 id 从 requested 集合移除以便后续重试;成功的 closeTime 可能为 null(gamma 也没有时间)。
  fetchMarketMeta: async (conditionIds: string[]) => {
    if (Date.now() < metaRetryAfter) {
      return; // 上次失败后的退避窗口内,先不重试。
    }
    const pending = conditionIds.filter((id) => id && !requestedConditionIds.has(id));
    if (pending.length === 0) {
      return;
    }
    const generation = monitorGeneration;
    for (const id of pending) {
      requestedConditionIds.add(id);
    }
    try {
      const meta = await getMarketMeta(pending);
      if (generation !== monitorGeneration) {
        return; // 已换会话(startMonitoring),丢弃旧结果,勿覆盖新 marketMeta。
      }
      set((state) => ({ marketMeta: { ...state.marketMeta, ...meta } }));
      // gamma 未返回的 id 保留在 requested 中不重试(查无此市场),仅网络错误才整批重试。
    } catch {
      metaRetryAfter = Date.now() + 5000;
      if (generation === monitorGeneration) {
        for (const id of pending) {
          requestedConditionIds.delete(id);
        }
      }
    }
  },

  // 汇总条「今日」:低频拉取滚动 24h P&L,与 WS 行情解耦;失败静默(非关键)。
  fetchTodayPnl: async () => {
    const address = get().config.address;
    if (!address || !get().config.showSummary) {
      return;
    }
    try {
      const pnl = await getTodayPnl(address);
      set({ todayPnl: pnl });
    } catch {
      // 网络/接口波动不影响主功能,保留上次值。
    }
  },

  // #2 成交历史:按地址拉真实成交并以平均成本法回放算每笔/总已实现盈亏。on-demand(打开流水视图时)。
  fetchTrades: async () => {
    const address = get().config.address;
    if (!address) {
      set({ tradeHistory: null, tradesError: null, tradesLoading: false });
      return;
    }
    set({ tradesLoading: true, tradesError: null });
    try {
      const limit = 500;
      const { trades, redeems } = await getActivity(address, limit);
      // 按需拉取这些市场的官方费率表(gamma,不在实时监控路径上);失败则降级为不校正手续费。
      let feeFor: FeeResolver | undefined;
      try {
        const conditionIds = [...new Set(trades.map((t) => t.conditionId).filter((id) => id.length > 0))];
        const meta = await getMarketMeta(conditionIds);
        feeFor = (conditionId: string) => meta[conditionId]?.fee ?? null;
      } catch {
        feeFor = undefined; // 费率拉取失败:不校正(已实现盈亏为不含费的口径)。
      }
      const history = computeTradeHistory(trades, redeems, feeFor);
      // 命中条数上限 → 历史可能被截断,早期买入缺失会高估已实现盈亏(与 excess 触发的 truncated 合并)。
      if (trades.length >= limit) {
        history.truncated = true;
      }
      set({ tradeHistory: history, tradesLoading: false });
    } catch (error) {
      // 失败时清空旧数据,避免与错误并列展示造成误解。
      set({ tradeHistory: null, tradesLoading: false, tradesError: error instanceof Error ? error.message : String(error) });
    }
  },

  armStopLoss: async (asset: string, params: StopLossConfigPatch = {}) => {
    const current = get().stopLossConfigs[asset];
    const nextConfig = normalizeStopLossConfig({ ...current, ...params, armed: true });
    const nextConfigs = { ...get().stopLossConfigs, [asset]: nextConfig };
    await writeStopLossConfigs(nextConfigs);
    set({ stopLossConfigs: nextConfigs });
  },

  disarmStopLoss: async (asset: string) => {
    const current = get().stopLossConfigs[asset];
    const nextConfig = normalizeStopLossConfig({ ...current, armed: false });
    const nextConfigs = { ...get().stopLossConfigs, [asset]: nextConfig };
    await writeStopLossConfigs(nextConfigs);
    activeStopLossMonitor?.removeAsset(asset);
    clearSemiAutoTimer(asset);
    set((state) => {
      const nextPending = { ...state.pendingStopLoss };
      delete nextPending[asset];
      return {
        stopLossConfigs: nextConfigs,
        stopLossStatuses: patchStopLossStatus(state.stopLossStatuses, asset, { cooldownUntil: 0 }),
        pendingStopLoss: nextPending,
      };
    });
  },

  setStopLossParams: async (asset: string, params: StopLossConfigPatch) => {
    const current = get().stopLossConfigs[asset];
    const nextConfig = normalizeStopLossConfig({ ...current, ...params });
    const nextConfigs = { ...get().stopLossConfigs, [asset]: nextConfig };
    await writeStopLossConfigs(nextConfigs);
    set({ stopLossConfigs: nextConfigs });
  },

  executeStopLoss: async (asset: string, details: StopLossTriggerDetails) => {
    const t = (key: I18nKey, params?: Record<string, string | number>) => translate(get().config.lang, key, params);
    const position = get().snapshot?.positions.find((item) => item.asset === asset);
    const positionSize = position?.size ?? details.sizeNow;
    const qty = roundDownShares(details.sellFraction * details.sizeNow);
    const triggeredAt = Date.now();
    const formattedQty = qty.toLocaleString(undefined, { maximumFractionDigits: 2 });

    set((state) => ({
      stopLossStatuses: patchStopLossStatus(state.stopLossStatuses, asset, {
        lastTriggeredAt: triggeredAt,
        lastResult: t('stopLoss.triggerSubmitting', { qty: formattedQty }),
        lastError: null,
      }),
    }));

    if (!position || !Number.isFinite(qty) || qty <= 0) {
      const message = !position ? t('stopLoss.positionGone') : t('stopLoss.invalidQuantity');
      set((state) => ({
        stopLossStatuses: patchStopLossStatus(state.stopLossStatuses, asset, { lastResult: null, lastError: message }),
      }));
      notifyDesktop(t('stopLoss.failedTitle'), message);
      return;
    }

    try {
      const response = await sendRuntimeMessage<PlaceOrderOkResponse | ErrorResponse>({
        type: 'STOP_LOSS_SELL',
        tokenID: asset,
        qty,
        bestBid: details.priceNow,
        negRisk: position.negativeRisk,
        avgPrice: position.avgPrice,
        positionSize,
      });
      if ('error' in response) {
        throw new Error(response.error);
      }

      const result = response.data;
      const message = result.dryRun
        ? t('stopLoss.resultDryRun', {
            orderType: result.orderType,
            size: result.size.toLocaleString(undefined, { maximumFractionDigits: 2 }),
            price: result.price.toFixed(4),
          })
        : t('stopLoss.resultSubmitted', {
            orderType: result.orderType,
            size: result.size.toLocaleString(undefined, { maximumFractionDigits: 2 }),
            price: result.price.toFixed(4),
          });
      set((state) => ({
        stopLossStatuses: patchStopLossStatus(state.stopLossStatuses, asset, { lastResult: message, lastError: null }),
      }));
      notifyDesktop(result.dryRun ? t('stopLoss.dryRunTitle') : t('stopLoss.submittedTitle'), message);
      // S1:真实单零成交(FAK 未撮合)不算已保护——settle 让持续破位的仓尽快重试。
      const filled = result.dryRun || Number(result.takingAmount ?? 0) > 0 || Number(result.makingAmount ?? 0) > 0;
      if (!filled) {
        activeStopLossMonitor?.settle(asset, STOPLOSS_RETRY_MS);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        stopLossStatuses: patchStopLossStatus(state.stopLossStatuses, asset, { lastResult: null, lastError: message }),
      }));
      notifyDesktop(t('stopLoss.failedTitle'), message);
      // SEVERE 3:失败不静默禁用——清冷却并设短退避,持续破位的仓可在 STOPLOSS_RETRY_MS 后重试。
      activeStopLossMonitor?.settle(asset, STOPLOSS_RETRY_MS);
    }
  },

  requestStopLossConfirm: (asset: string, details: StopLossTriggerDetails) => {
    const t = (key: I18nKey, params?: Record<string, string | number>) => translate(get().config.lang, key, params);
    const position = get().snapshot?.positions.find((item) => item.asset === asset);
    const qty = roundDownShares(details.sellFraction * details.sizeNow);
    // 量无效或持仓已不在:退回直接执行(executeStopLoss 内部会再校验并报错)。
    if (!position || !Number.isFinite(qty) || qty <= 0) {
      void get().executeStopLoss(asset, details);
      return;
    }

    const pending: PendingStopLoss = { asset, title: position.title, details, qty, deadline: Date.now() + SEMI_AUTO_TTL_MS };
    set((state) => ({ pendingStopLoss: { ...state.pendingStopLoss, [asset]: pending } }));
    notifyDesktop(
      t('semiAuto.notifyTitle'),
      t('semiAuto.notifyBody', { title: position.title, qty: qty.toLocaleString(undefined, { maximumFractionDigits: 2 }) }),
    );
    clearSemiAutoTimer(asset);
    // fail-safe:超时自动执行(不取消),避免人不在时彻底失去保护。
    semiAutoTimers.set(asset, setTimeout(() => get().confirmStopLoss(asset), SEMI_AUTO_TTL_MS));
  },

  confirmStopLoss: (asset: string) => {
    clearSemiAutoTimer(asset);
    const pending = get().pendingStopLoss[asset];
    set((state) => {
      const next = { ...state.pendingStopLoss };
      delete next[asset];
      return { pendingStopLoss: next };
    });
    if (pending) {
      void get().executeStopLoss(asset, pending.details);
    }
  },

  cancelStopLoss: (asset: string) => {
    clearSemiAutoTimer(asset);
    set((state) => {
      const next = { ...state.pendingStopLoss };
      delete next[asset];
      return { pendingStopLoss: next };
    });
    // M1:取消 = snooze;持续破位在退避后重新弹确认,而非永久静默。
    activeStopLossMonitor?.settle(asset, SEMI_AUTO_SNOOZE_MS);
  },

  startMonitoring: () => {
    monitoringActive = true;
    stopActiveSource();
    // 换地址/重启监控:进入新代次,清空封盘元数据/已请求集合/价格历史,按新持仓重新拉。
    monitorGeneration += 1;
    requestedConditionIds.clear();
    metaRetryAfter = 0;
    // 半自动:重启监控时清空待确认队列与定时器(旧会话的悬挂确认不应延续)。
    semiAutoTimers.forEach((timer) => clearTimeout(timer));
    semiAutoTimers.clear();
    set({ marketMeta: {}, priceHistory: {}, pendingStopLoss: {} });

    const config = get().config;
    if (!config.address) {
      set({ snapshot: null, isLoading: false });
      return;
    }

    const source = new WsSource({
      address: config.address,
      positionsIntervalMs: config.positionsIntervalMs,
    });
    activeStopLossMonitor = new StopLossMonitor((asset, details) => {
      // 半自动:开启的仓触发时入队等人工确认;否则直接执行(全自动)。
      const resolved = resolveStopLossConfig(get().stopLossConfigs[asset], get().stopLossDefaults);
      if (resolved.semiAutoMode) {
        get().requestStopLossConfirm(asset, details);
      } else {
        void get().executeStopLoss(asset, details);
      }
    });
    activeAlertMonitor = new AlertMonitor((trigger) => {
      void handleAlertTrigger(get, trigger);
    });
    activeConditionalMonitor = new ConditionalMonitor((asset, details) => {
      void get().executeConditional(asset, details);
    });

    activeSource = source;
    activeUnsubscribe = source.subscribe((snapshot) => {
      // 每个行情 tick 只 set 一次(合并快照与止损状态),避免一跳触发两次 React 渲染。
      const stopLossMonitorStatuses =
        activeStopLossMonitor?.processSnapshot(snapshot, get().stopLossConfigs, get().stopLossDefaults) ?? {};
      // #3 到价提醒:逐 tick 评估阈值;触发只回调通知,不改 store(避免行情帧多余渲染)。
      activeAlertMonitor?.processSnapshot(snapshot, get().priceAlertConfigs);
      // #6 条件单/OCO:逐 tick 评估止盈/离场腿;触发回调 executeConditional。
      activeConditionalMonitor?.processSnapshot(snapshot, get().conditionalConfigs);
      set((state) => ({
        snapshot,
        isLoading: snapshot.lastUpdated === 0 && snapshot.error === null,
        // mergeMonitorStatuses 在无止损更新时原样返回同一引用,不会无谓刷新订阅方。
        stopLossStatuses: mergeMonitorStatuses(state.stopLossStatuses, stopLossMonitorStatuses),
        // #1 价格走势:同一帧采样一次;无价格变化时 samplePriceHistory 返回同引用,sparkline 订阅方不重渲染。
        priceHistory: samplePriceHistory(state.priceHistory, snapshot),
      }));
      // #4 封盘倒计时:为本帧新出现的 conditionId 低频补拉 gamma 元数据(内部去重,非阻塞)。
      if (snapshot.positions.length > 0) {
        void get().fetchMarketMeta(snapshot.positions.map((p) => p.conditionId));
      }
      // S2 兜底:半自动 fail-safe 不只依赖 setTimeout——逐 tick 兜底执行已超时的待确认
      // (面板重载等导致 timer 丢失时仍能在下一帧自动平仓;confirmStopLoss 幂等,不会与 timer 双发)。
      const pending = get().pendingStopLoss;
      const nowTs = Date.now();
      for (const item of Object.values(pending)) {
        if (item.deadline <= nowTs) {
          get().confirmStopLoss(item.asset);
        }
      }
    });
    set({ isLoading: true });
    source.start();
  },

  stopMonitoring: () => {
    monitoringActive = false;
    stopActiveSource();
    set({ isLoading: false });
  },

  // 手动刷新:立即重拉一次(行情仍由 WS 实时推送)。
  refresh: () => {
    activeSource?.refresh();
  },

  refreshAuthStatus: async () => {
    const response = await sendRuntimeMessage<AuthResponse>({ type: 'GET_AUTH_STATUS' });
    if ('error' in response || 'ok' in response) {
      throw new Error('Invalid auth status response.');
    }

    set({ authStatus: response });
  },

  importKey: async (privateKey: string, password: string) => {
    assertOk(await sendRuntimeMessage<AuthResponse>({ type: 'IMPORT_KEY', privateKey, password }));
    await get().refreshAuthStatus();
  },

  unlock: async (password: string) => {
    assertOk(await sendRuntimeMessage<AuthResponse>({ type: 'UNLOCK', password }));
    await get().refreshAuthStatus();
  },

  lock: async () => {
    assertOk(await sendRuntimeMessage<AuthResponse>({ type: 'LOCK' }));
    await get().refreshAuthStatus();
  },

  forgetKey: async () => {
    assertOk(await sendRuntimeMessage<AuthResponse>({ type: 'FORGET_KEY' }));
    await get().refreshAuthStatus();
  },

  // 第一步:后台构建+校验并返回一次性 nonce + 预览(不提交)。
  prepareOrder: async (payload) => {
    set({ isTrading: true });
    try {
      const response = await sendRuntimeMessage<PrepareOrderOkResponse | ErrorResponse>({ type: 'PREPARE_ORDER', ...payload });
      if ('error' in response) {
        set((state) => ({ orderErrors: { ...state.orderErrors, [payload.tokenID]: response.error } }));
        throw new Error(response.error);
      }

      set((state) => ({ orderErrors: { ...state.orderErrors, [payload.tokenID]: null } }));
      return response.data;
    } finally {
      set({ isTrading: false });
    }
  },

  // 第二步:用户在确认弹窗点确认后,凭 nonce 让后台真正提交。
  confirmOrder: async (nonce: string, tokenID: string) => {
    set({ isTrading: true });
    try {
      const response = await sendRuntimeMessage<PlaceOrderOkResponse | ErrorResponse>({ type: 'CONFIRM_ORDER', nonce });
      if ('error' in response) {
        set((state) => ({ orderErrors: { ...state.orderErrors, [tokenID]: response.error } }));
        throw new Error(response.error);
      }

      set((state) => ({ orderErrors: { ...state.orderErrors, [tokenID]: null } }));
      return response.data;
    } finally {
      set({ isTrading: false });
    }
  },

  getOpenOrders: async (asset: string) => {
    const response = await sendRuntimeMessage<GetOpenOrdersOkResponse | ErrorResponse>({ type: 'GET_OPEN_ORDERS', asset });
    if ('error' in response) {
      set((state) => ({ orderErrors: { ...state.orderErrors, [asset]: response.error } }));
      throw new Error(response.error);
    }

    set((state) => ({
      openOrders: { ...state.openOrders, [asset]: response.data },
      orderErrors: { ...state.orderErrors, [asset]: null },
    }));
    return response.data;
  },

  cancelOrder: async (asset: string, orderID: string) => {
    const response = await sendRuntimeMessage<TradingOkResponse | ErrorResponse>({ type: 'CANCEL_ORDER', orderID });
    if ('error' in response) {
      set((state) => ({ orderErrors: { ...state.orderErrors, [asset]: response.error } }));
      throw new Error(response.error);
    }

    await get().getOpenOrders(asset);
  },

  cancelAll: async (asset: string) => {
    const response = await sendRuntimeMessage<TradingOkResponse | ErrorResponse>({ type: 'CANCEL_ALL', asset });
    if ('error' in response) {
      set((state) => ({ orderErrors: { ...state.orderErrors, [asset]: response.error } }));
      throw new Error(response.error);
    }

    await get().getOpenOrders(asset);
  },
}));

void monitorStore.getState().refreshAuthStatus();

export const useMonitorStore = monitorStore;

export function useT() {
  const lang = useMonitorStore((state) => state.config.lang);
  return (key: I18nKey, params?: Record<string, string | number>) => translate(lang, key, params);
}
