import type { OrderBook, Position } from '@/lib/types';

export interface Snapshot {
  positions: Position[];
  books: Record<string, OrderBook>;
  lastUpdated: number;
  // 仅在持仓 REST 刷新时更新(book/price 的 WS tick 不会动它)。
  // 用于「跟随持仓刷新」而非「跟随每个行情 tick」的订阅,如挂单重拉。
  positionsUpdatedAt?: number;
  error: string | null;
}

export interface DataSource {
  start(): void;
  stop(): void;
  // 立即拉取一次(手动刷新按钮)。
  refresh(): void;
  subscribe(cb: (snap: Snapshot) => void): () => void;
}
