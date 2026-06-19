// #3 到价提醒监控器:在面板的行情合帧回调里逐 tick 评估每仓的阈值条件,跨越阈值时回调通知。
// 仅被动通知,绝不下单。仅面板开着时生效(复用面板内 WS 价格流,与止损监控同处)。
//
// 触发语义(latch 防抖):
//  - 条件由「不满足→满足」跨越时才触发一次(进入即触发,而非持续满足期间每帧触发)。
//  - 条件回到「不满足」时重新武装(latched=false),下次再跨越可再触发(repeat 模式)。
//  - 一次性(repeat=false):触发后置 disabledOneShot,本会话不再触发;调用方应清除该阈值以持久化「已解除」。

import { getBestBid } from '@/lib/api/clobApi';
import { unrealizedPnl } from '@/lib/calc/pnl';
import type { Snapshot } from '@/lib/datasource/types';
import {
  ALERT_CONDITION_KEYS,
  type AlertConditionKey,
  type PriceAlertConfigs,
} from '@/shared/priceAlertConfig';

export interface AlertTrigger {
  asset: string;
  title: string;
  outcome: string;
  conditionKey: AlertConditionKey;
  threshold: number;
  /** 触发时的实际值(价用 0~1,pnlPct 用百分数,value 用 USD)。 */
  actual: number;
  /** true=一次性触发(repeat=false),调用方应清除该阈值持久化解除。 */
  oneShot: boolean;
}

interface ConditionRuntime {
  latched: boolean;
  disabledOneShot: boolean;
}

function metricFor(key: AlertConditionKey, price: number, pnlPct: number, value: number): number {
  switch (key) {
    case 'priceAbove':
    case 'priceBelow':
      return price;
    case 'pnlPctAbove':
    case 'pnlPctBelow':
      return pnlPct;
    case 'valueAbove':
      return value;
  }
}

function conditionMet(key: AlertConditionKey, metric: number, threshold: number): boolean {
  switch (key) {
    case 'priceAbove':
    case 'pnlPctAbove':
    case 'valueAbove':
      return metric >= threshold;
    case 'priceBelow':
    case 'pnlPctBelow':
      return metric <= threshold;
  }
}

export class AlertMonitor {
  // asset → (conditionKey → runtime)
  private readonly runtimes = new Map<string, Map<AlertConditionKey, ConditionRuntime>>();

  constructor(private readonly onTrigger: (trigger: AlertTrigger) => void) {}

  processSnapshot(snapshot: Snapshot, configs: PriceAlertConfigs): void {
    const activeAssets = new Set<string>();

    for (const position of snapshot.positions) {
      const config = configs[position.asset];
      if (!config?.enabled || position.redeemable || position.size <= 0) {
        continue;
      }

      // 只要仍是已启用的有效持仓就保留其 runtime(即便本帧暂无有效价),避免价格缺失帧
      // 误删 runtime 导致 latch / disabledOneShot 丢失,价格恢复后无「假→真跨越」即重复触发。
      activeAssets.add(position.asset);

      const price = getBestBid(snapshot.books[position.asset]) || (Number.isFinite(position.curPrice) ? position.curPrice : 0);
      if (!(price > 0)) {
        continue; // 本帧无有效价:保留 runtime,跳过评估。
      }
      const pnlPct = unrealizedPnl(position.size, position.avgPrice, price).percent;
      const value = price * position.size;

      const assetRuntime = this.ensureAssetRuntime(position.asset);

      for (const key of ALERT_CONDITION_KEYS) {
        const threshold = config[key];
        if (threshold === null) {
          // 阈值被清除:复位该条件 runtime,使将来重新设置时从干净状态开始。
          assetRuntime.delete(key);
          continue;
        }
        const metric = metricFor(key, price, pnlPct, value);
        if (!Number.isFinite(metric)) {
          continue; // 指标非有限(如脏 avgPrice 致 pnlPct=NaN):本帧不评估该条件,保持 latch 不变。
        }
        const state = this.ensureConditionRuntime(assetRuntime, key);
        if (state.disabledOneShot) {
          continue;
        }

        const met = conditionMet(key, metric, threshold);
        if (met && !state.latched) {
          state.latched = true;
          if (!config.repeat) {
            state.disabledOneShot = true;
          }
          this.onTrigger({
            asset: position.asset,
            title: position.title,
            outcome: position.outcome,
            conditionKey: key,
            threshold,
            actual: metricFor(key, price, pnlPct, value),
            oneShot: !config.repeat,
          });
        } else if (!met && state.latched) {
          state.latched = false;
        }
      }
    }

    for (const asset of this.runtimes.keys()) {
      if (!activeAssets.has(asset)) {
        this.runtimes.delete(asset);
      }
    }
  }

  removeAsset(asset: string): void {
    this.runtimes.delete(asset);
  }

  reset(): void {
    this.runtimes.clear();
  }

  private ensureAssetRuntime(asset: string): Map<AlertConditionKey, ConditionRuntime> {
    let runtime = this.runtimes.get(asset);
    if (!runtime) {
      runtime = new Map();
      this.runtimes.set(asset, runtime);
    }
    return runtime;
  }

  private ensureConditionRuntime(
    assetRuntime: Map<AlertConditionKey, ConditionRuntime>,
    key: AlertConditionKey,
  ): ConditionRuntime {
    let state = assetRuntime.get(key);
    if (!state) {
      state = { latched: false, disabledOneShot: false };
      assetRuntime.set(key, state);
    }
    return state;
  }
}
