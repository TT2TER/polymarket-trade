// #6 条件单 / OCO 监控器:在面板行情合帧回调里逐 tick 评估每仓的止盈/离场腿,价格触及即回调。
// 触发即提交卖单(走 store→后台 CONDITIONAL_SELL,遵守 dryRun + 资金上限 + 后台冷却)。
// OCO:任一腿触发后(由 store 在提交后解除武装),整张配置失效。
// firedOnce:本会话每个武装周期只触发一次,防止解除武装持久化完成前的重复触发。

import { getBestBid } from '@/lib/api/clobApi';
import type { Snapshot } from '@/lib/datasource/types';
import {
  hasStopExit,
  hasTakeProfit,
  type ConditionalConfigs,
  type ConditionalLeg,
} from '@/shared/conditionalConfig';

export interface ConditionalTriggerDetails {
  leg: ConditionalLeg;
  fraction: number;
  priceNow: number;
  sizeNow: number;
}

interface AssetRuntime {
  // 已触发并提交,等待 store 裁决(成交→disarm / 失败→settle 重试 / 模拟→settle 重测);blocked 时不再触发。
  blocked: boolean;
  // 退避时点:settle 后在此之前不评估,避免失败后每帧重试导致连发。
  retryAfter: number;
}

export class ConditionalMonitor {
  private readonly runtimes = new Map<string, AssetRuntime>();

  constructor(private readonly onTrigger: (asset: string, details: ConditionalTriggerDetails) => void) {}

  processSnapshot(snapshot: Snapshot, configs: ConditionalConfigs, now = Date.now()): void {
    const activeAssets = new Set<string>();

    for (const position of snapshot.positions) {
      const config = configs[position.asset];
      if (!config?.armed || position.redeemable || position.size <= 0) {
        continue;
      }

      activeAssets.add(position.asset);
      // money-path:必须有真实盘口买一才触发/下单(不退回 curPrice,后者未必可成交,与止损一致)。
      const price = getBestBid(snapshot.books[position.asset]);
      if (!(price > 0)) {
        continue; // 本帧无有效买价:保留 runtime,跳过评估。
      }

      const runtime = this.ensureRuntime(position.asset);
      if (runtime.blocked || now < runtime.retryAfter) {
        continue;
      }

      // 止盈优先于离场判定(同一帧两腿都满足时只触发止盈一次)。
      if (hasTakeProfit(config) && price >= (config.takeProfitPrice as number)) {
        runtime.blocked = true;
        this.onTrigger(position.asset, {
          leg: 'takeProfit',
          fraction: config.takeProfitFraction as number,
          priceNow: price,
          sizeNow: position.size,
        });
        continue;
      }
      if (hasStopExit(config) && price <= (config.stopExitPrice as number)) {
        runtime.blocked = true;
        this.onTrigger(position.asset, {
          leg: 'stopExit',
          fraction: config.stopExitFraction as number,
          priceNow: price,
          sizeNow: position.size,
        });
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

  // 触发提交后由 store 裁决:失败/模拟成功时解除 blocked 并设退避(可在退避后重新触发);
  // 真实成交则改走 removeAsset(disarm)。未成交的真实成功不应调用本方法(保持 blocked,防重复卖)。
  settle(asset: string, retryAfterMs: number, now = Date.now()): void {
    const runtime = this.runtimes.get(asset);
    if (runtime) {
      runtime.blocked = false;
      runtime.retryAfter = now + Math.max(0, retryAfterMs);
    }
  }

  reset(): void {
    this.runtimes.clear();
  }

  private ensureRuntime(asset: string): AssetRuntime {
    let runtime = this.runtimes.get(asset);
    if (!runtime) {
      runtime = { blocked: false, retryAfter: 0 };
      this.runtimes.set(asset, runtime);
    }
    return runtime;
  }
}
