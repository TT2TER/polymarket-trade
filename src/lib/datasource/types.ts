import type { OrderBook, Position } from '@/lib/types';

export interface Snapshot {
  positions: Position[];
  books: Record<string, OrderBook>;
  lastUpdated: number;
  error: string | null;
}

export interface DataSource {
  start(): void;
  stop(): void;
  // 立即拉取一次(手动刷新按钮)。
  refresh(): void;
  subscribe(cb: (snap: Snapshot) => void): () => void;
}
