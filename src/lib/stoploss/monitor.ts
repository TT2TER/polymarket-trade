import { getBestBid } from '@/lib/api/clobApi';
import type { Snapshot } from '@/lib/datasource/types';
import {
  createStopLossDetectorState,
  evaluate,
  type StopLossDetectorState,
  type StopLossRegime,
} from '@/lib/stoploss/detector';
import {
  DEFAULT_STOP_LOSS_DEFAULTS,
  resolveStopLossConfig,
  type StopLossConfigs,
  type StopLossDefaults,
} from '@/shared/stopLossConfig';

export interface StopLossTriggerDetails {
  sellFraction: number;
  drop: number;
  threshold: number;
  priceNow: number;
  ref: number;
  cost: number;
  peak: number;
  exitLine: number;
  regime: StopLossRegime;
  sizeNow: number;
}

export interface StopLossMonitorStatus {
  drop: number;
  threshold: number;
  sellFraction: number;
  cooldownUntil: number;
  priceNow: number;
  ref: number;
  cost: number;
  peak: number;
  exitLine: number;
  regime: StopLossRegime;
  activated: boolean;
  breach: boolean;
  dwellMs: number;
  dwellRemainingMs: number;
}

export type StopLossMonitorStatuses = Record<string, StopLossMonitorStatus>;

interface AssetRuntime {
  detector: StopLossDetectorState;
  status: StopLossMonitorStatus;
}

export class StopLossMonitor {
  private readonly runtimes = new Map<string, AssetRuntime>();

  constructor(private readonly onTrigger: (asset: string, details: StopLossTriggerDetails) => void) {}

  processSnapshot(
    snapshot: Snapshot,
    configs: StopLossConfigs,
    defaults: StopLossDefaults = DEFAULT_STOP_LOSS_DEFAULTS,
    now = Date.now(),
  ): StopLossMonitorStatuses {
    const activeAssets = new Set<string>();

    for (const position of snapshot.positions) {
      const config = resolveStopLossConfig(configs[position.asset], defaults);
      if (!config.armed || position.redeemable || position.size <= 0 || position.avgPrice <= 0) {
        continue;
      }

      // 武装且持仓仍在:先占住 runtime,避免瞬时空盘帧把它当"持仓消失"清空(丢 peak/激活/冷却)。
      activeAssets.add(position.asset);
      const runtime = this.ensureRuntime(position.asset);

      const priceNow = getBestBid(snapshot.books[position.asset]);
      if (priceNow <= 0) {
        // 本帧无有效买价:打断 dwell 连续性(空帧不算"持续确认"),跳过评估但保留状态。
        runtime.detector.dwellGate.reset();
        continue;
      }

      const result = evaluate(runtime.detector, priceNow, now, {
        cost: position.avgPrice,
        config,
      });

      runtime.status = {
        drop: result.drop,
        threshold: result.threshold,
        sellFraction: result.sellFraction,
        cooldownUntil: result.cooldownUntil,
        priceNow: result.priceNow,
        ref: result.ref,
        cost: result.cost,
        peak: result.peak,
        exitLine: result.exitLine,
        regime: result.regime,
        activated: result.activated,
        breach: result.breach,
        dwellMs: result.dwellMs,
        dwellRemainingMs: result.dwellRemainingMs,
      };

      if (result.triggered) {
        this.onTrigger(position.asset, {
          sellFraction: result.sellFraction,
          drop: result.drop,
          threshold: result.threshold,
          priceNow,
          ref: result.ref,
          cost: result.cost,
          peak: result.peak,
          exitLine: result.exitLine,
          regime: result.regime,
          sizeNow: position.size,
        });
      }
    }

    for (const asset of this.runtimes.keys()) {
      if (!activeAssets.has(asset)) {
        this.runtimes.delete(asset);
      }
    }

    return this.statuses();
  }

  removeAsset(asset: string): void {
    this.runtimes.delete(asset);
  }

  reset(): void {
    this.runtimes.clear();
  }

  statuses(): StopLossMonitorStatuses {
    const statuses: StopLossMonitorStatuses = {};
    for (const [asset, runtime] of this.runtimes) {
      statuses[asset] = runtime.status;
    }
    return statuses;
  }

  private ensureRuntime(asset: string): AssetRuntime {
    const existing = this.runtimes.get(asset);
    if (existing) {
      return existing;
    }

    const runtime: AssetRuntime = {
      detector: createStopLossDetectorState(),
      status: {
        drop: 0,
        threshold: 0,
        sellFraction: 0,
        cooldownUntil: 0,
        priceNow: 0,
        ref: 0,
        cost: 0,
        peak: 0,
        exitLine: 0,
        regime: 'loss-floor',
        activated: false,
        breach: false,
        dwellMs: 0,
        dwellRemainingMs: 0,
      },
    };
    this.runtimes.set(asset, runtime);
    return runtime;
  }
}
