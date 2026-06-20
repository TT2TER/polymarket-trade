import { describe, expect, it } from 'vitest';
import { StopLossMonitor } from '@/lib/stoploss/monitor';
import { DEFAULT_STOP_LOSS_DEFAULTS, normalizeStopLossConfig, type StopLossConfigs } from '@/shared/stopLossConfig';
import type { Snapshot } from '@/lib/datasource/types';
import type { OrderBook, Position } from '@/lib/types';

const ASSET = 'token-1';

function book(bid: number | null): OrderBook {
  return {
    market: 'm',
    asset_id: ASSET,
    timestamp: '0',
    bids: bid != null ? [{ price: String(bid), size: '1000' }] : [],
    asks: [],
  } as OrderBook;
}

function snapshot(bid: number | null): Snapshot {
  const position = { asset: ASSET, size: 100, avgPrice: 0.2, redeemable: false } as unknown as Position;
  return { positions: [position], books: { [ASSET]: book(bid) }, lastUpdated: 1, error: null };
}

function configs(): StopLossConfigs {
  return { [ASSET]: normalizeStopLossConfig({ armed: true, dwellMs: 1_000 }) };
}

describe('StopLossMonitor — 无效报价帧处理(SEVERE 2 回归)', () => {
  it('空盘帧打断 dwell 连续性,且不丢 peak/激活状态', () => {
    const triggers: string[] = [];
    const monitor = new StopLossMonitor((asset) => triggers.push(asset));
    const cfg = configs();
    const d = DEFAULT_STOP_LOSS_DEFAULTS;

    // 涨到 0.78 激活跟踪。
    monitor.processSnapshot(snapshot(0.78), cfg, d, 1_000);
    // 跌到 0.5:中位数随之下行进入 breach,dwell 开始计时。
    monitor.processSnapshot(snapshot(0.5), cfg, d, 1_100);
    monitor.processSnapshot(snapshot(0.5), cfg, d, 1_200);
    let status = monitor.statuses()[ASSET];
    expect(status.activated).toBe(true);
    expect(status.breach).toBe(true);
    expect(triggers).toHaveLength(0);

    // 空盘帧(无有效买一)且时间大幅前进:必须重置 dwell,且保留 runtime(peak/激活不丢)。
    monitor.processSnapshot(snapshot(null), cfg, d, 5_000);
    status = monitor.statuses()[ASSET];
    expect(status.activated).toBe(true); // 状态保留,未被当作"持仓消失"清空

    // 报价恢复:虽然距最初 breach 已远超 dwell 窗口,但 dwell 应从空盘后重新计时 → 本帧不得触发。
    monitor.processSnapshot(snapshot(0.5), cfg, d, 5_050);
    expect(triggers).toHaveLength(0);

    // 连续维持满 dwell 后才真正触发。
    monitor.processSnapshot(snapshot(0.5), cfg, d, 6_100);
    expect(triggers).toEqual([ASSET]);
  });

  it('settle 在失败后清冷却,持续破位可在退避后重试(SEVERE 3)', () => {
    let count = 0;
    const monitor = new StopLossMonitor(() => {
      count += 1;
    });
    const cfg: StopLossConfigs = {
      [ASSET]: normalizeStopLossConfig({ armed: true, anchor: 'cost', maxLossPct: 0.25, dwellMs: 0 }),
    };
    const d = DEFAULT_STOP_LOSS_DEFAULTS; // exitLine = 0.2*(1-0.25) = 0.15

    monitor.processSnapshot(snapshot(0.14), cfg, d, 1_000); // 跌破地板 → 立即触发
    expect(count).toBe(1);
    monitor.processSnapshot(snapshot(0.14), cfg, d, 2_000); // 冷却中 → 不重复
    expect(count).toBe(1);

    monitor.settle(ASSET, 15_000, 2_000); // 模拟下单失败:设 15s 退避

    monitor.processSnapshot(snapshot(0.14), cfg, d, 10_000); // 退避未到 → 仍不触发
    expect(count).toBe(1);
    monitor.processSnapshot(snapshot(0.14), cfg, d, 18_000); // 退避已过 + 持续破位 → 重试
    expect(count).toBe(2);
  });
});
