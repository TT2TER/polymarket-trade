import { getBestBid } from '@/lib/api/clobApi';
import type { Snapshot } from '@/lib/datasource/types';
import {
  DEFAULT_STOP_LOSS_WINDOW_MS,
  createStopLossDetectorState,
  evaluate,
  type StopLossDetectorState,
} from '@/lib/stoploss/detector';
import type { StopLossConfigs } from '@/shared/stopLossConfig';

export interface StopLossTriggerDetails {
  sellFraction: number;
  drop: number;
  threshold: number;
  priceNow: number;
  sizeNow: number;
}

export interface StopLossMonitorStatus {
  drop: number;
  threshold: number;
  sellFraction: number;
  cooldownUntil: number;
}

export type StopLossMonitorStatuses = Record<string, StopLossMonitorStatus>;

interface AssetRuntime {
  detector: StopLossDetectorState;
  status: StopLossMonitorStatus;
}

export class StopLossMonitor {
  private readonly runtimes = new Map<string, AssetRuntime>();

  constructor(private readonly onTrigger: (asset: string, details: StopLossTriggerDetails) => void) {}

  processSnapshot(snapshot: Snapshot, configs: StopLossConfigs, now = Date.now()): StopLossMonitorStatuses {
    const activeAssets = new Set<string>();

    for (const position of snapshot.positions) {
      const config = configs[position.asset];
      if (!config?.armed || position.redeemable || position.size <= 0) {
        continue;
      }

      const priceNow = getBestBid(snapshot.books[position.asset]);
      if (priceNow <= 0) {
        continue;
      }

      activeAssets.add(position.asset);
      const runtime = this.ensureRuntime(position.asset);
      const threshold = config.threshold ?? undefined;
      const sellFraction = config.sellFraction ?? undefined;
      const windowMs = config.windowMs ?? DEFAULT_STOP_LOSS_WINDOW_MS;
      const result = evaluate(runtime.detector, priceNow, now, {
        windowMs,
        threshold,
        sellFraction,
        value: priceNow * position.size,
      });

      runtime.status = {
        drop: result.drop,
        threshold: result.threshold,
        sellFraction: result.sellFraction,
        cooldownUntil: runtime.detector.cooldownUntil,
      };

      if (result.triggered) {
        this.onTrigger(position.asset, {
          sellFraction: result.sellFraction,
          drop: result.drop,
          threshold: result.threshold,
          priceNow,
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
      },
    };
    this.runtimes.set(asset, runtime);
    return runtime;
  }
}
