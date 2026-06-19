import { create } from 'zustand';
import type { OpenOrder } from '@polymarket/clob-client-v2';
import type { DataSource, Snapshot } from '@/lib/datasource/types';
import { roundDownShares, type PlaceSellResult } from '@/lib/trading/orders';
import { StopLossMonitor, type StopLossMonitorStatuses, type StopLossTriggerDetails } from '@/lib/stoploss/monitor';
import { WsSource } from '@/lib/datasource/wsSource';
import { getTodayPnl } from '@/lib/api/userPnl';
import { getMarketMeta, type MarketMeta } from '@/lib/api/gammaApi';
import { samplePriceHistory, type PriceHistory } from '@/lib/calc/priceHistory';
import { DEFAULT_CONFIG, readConfig, writeConfig, type AppConfig } from '@/shared/config';
import { translate, type I18nKey } from '@/shared/i18n';
import {
  normalizeStopLossConfig,
  readStopLossConfigs,
  writeStopLossConfigs,
  type StopLossConfigPatch,
  type StopLossConfigs,
} from '@/shared/stopLossConfig';
import { readTargetMultipliers, writeTargetMultipliers, type TargetMultipliers } from '@/shared/targetMultipliers';
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
  stopLossStatuses: StopLossStatuses;
  targetMultipliers: TargetMultipliers;
  todayPnl: number | null;
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
  loadTargetMultipliers: () => Promise<void>;
  setTargetMultiplier: (asset: string, n: number) => void;
  fetchMarketMeta: (conditionIds: string[]) => Promise<void>;
  fetchTodayPnl: () => Promise<void>;
  armStopLoss: (asset: string, params?: StopLossConfigPatch) => Promise<void>;
  disarmStopLoss: (asset: string) => Promise<void>;
  setStopLossParams: (asset: string, params: StopLossConfigPatch) => Promise<void>;
  executeStopLoss: (asset: string, details: StopLossTriggerDetails) => Promise<void>;
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
  lastTriggeredAt: number;
  lastResult: string | null;
  lastError: string | null;
}

export type StopLossStatuses = Record<string, StopLossStatus>;

let activeSource: DataSource | null = null;
let activeUnsubscribe: (() => void) | null = null;
let activeStopLossMonitor: StopLossMonitor | null = null;
let monitoringActive = false;
// 目标倍数 N 的 debounce 落盘计时器(拖动停止 ~500ms 后写一次,不打爆 storage)。
let targetMultipliersTimer: ReturnType<typeof setTimeout> | null = null;
// #4 封盘元数据:已请求(成功或在途)的 conditionId,避免行情每帧重复拉 gamma;startMonitoring 时清空。
const requestedConditionIds = new Set<string>();
// 监控代次:每次 startMonitoring +1。在途 gamma 请求返回时凭它丢弃旧会话结果(防 marketMeta 被 stale 覆盖)。
let monitorGeneration = 0;
// gamma 拉取失败后的退避时点:避免失败 id 被移出集合后在每个行情帧紧密重试。
let metaRetryAfter = 0;

function stopActiveSource(): void {
  activeUnsubscribe?.();
  activeUnsubscribe = null;
  activeSource?.stop();
  activeSource = null;
  activeStopLossMonitor?.reset();
  activeStopLossMonitor = null;
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

function notifyStopLoss(title: string, message: string): void {
  chrome.notifications.create({
    type: 'basic',
    iconUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVR42mNk+M9Qz0AEYBxVSFUBABYSEhH8q7AfAAAAAElFTkSuQmCC',
    title,
    message,
  });
}

const monitorStore = create<MonitorStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  stopLossConfigs: {},
  stopLossStatuses: {},
  targetMultipliers: {},
  todayPnl: null,
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
      set({ stopLossConfigs: await readStopLossConfigs() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        snapshot: errorSnapshot(translate(get().config.lang, 'stopLoss.configLoadFailed', { message })),
        isLoading: false,
      });
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
    set((state) => ({
      stopLossConfigs: nextConfigs,
      stopLossStatuses: patchStopLossStatus(state.stopLossStatuses, asset, { cooldownUntil: 0 }),
    }));
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
      notifyStopLoss(t('stopLoss.failedTitle'), message);
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
      notifyStopLoss(result.dryRun ? t('stopLoss.dryRunTitle') : t('stopLoss.submittedTitle'), message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        stopLossStatuses: patchStopLossStatus(state.stopLossStatuses, asset, { lastResult: null, lastError: message }),
      }));
      notifyStopLoss(t('stopLoss.failedTitle'), message);
    }
  },

  startMonitoring: () => {
    monitoringActive = true;
    stopActiveSource();
    // 换地址/重启监控:进入新代次,清空封盘元数据/已请求集合/价格历史,按新持仓重新拉。
    monitorGeneration += 1;
    requestedConditionIds.clear();
    metaRetryAfter = 0;
    set({ marketMeta: {}, priceHistory: {} });

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
      void get().executeStopLoss(asset, details);
    });

    activeSource = source;
    activeUnsubscribe = source.subscribe((snapshot) => {
      // 每个行情 tick 只 set 一次(合并快照与止损状态),避免一跳触发两次 React 渲染。
      const stopLossMonitorStatuses = activeStopLossMonitor?.processSnapshot(snapshot, get().stopLossConfigs) ?? {};
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
