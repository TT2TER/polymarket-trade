import { getBooks } from '@/lib/api/clobApi';
import { getPositions } from '@/lib/api/dataApi';
import type { OrderBook } from '@/lib/types';
import type { DataSource, Snapshot } from './types';

interface DirectSourceOptions {
  address: string;
  positionsIntervalMs: number;
  booksIntervalMs: number;
}

type PollName = 'positions' | 'books';

export class DirectSource implements DataSource {
  private readonly address: string;
  private readonly positionsIntervalMs: number;
  private readonly booksIntervalMs: number;
  private readonly subscribers = new Set<(snap: Snapshot) => void>();
  private positionsTimer: number | null = null;
  private booksTimer: number | null = null;
  private running = false;
  // 单调递增的轮询世代号:await 返回后若世代号已变(或已 stop),丢弃陈旧结果,避免慢响应覆盖新响应。
  private positionsEpoch = 0;
  private booksEpoch = 0;
  // 上一次的持仓 token 集合指纹,仅在集合变化时才在 positions 轮询后立即补拉一次 books,避免每周期叠加请求。
  private lastAssetKey = '';
  private errors: Record<PollName, string | null> = {
    positions: null,
    books: null,
  };
  private snapshot: Snapshot = {
    positions: [],
    books: {},
    lastUpdated: 0,
    error: null,
  };

  constructor(options: DirectSourceOptions) {
    this.address = options.address;
    this.positionsIntervalMs = options.positionsIntervalMs;
    this.booksIntervalMs = options.booksIntervalMs;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    void this.pollPositions();
    void this.pollBooks();
    this.positionsTimer = window.setInterval(() => {
      void this.pollPositions();
    }, this.positionsIntervalMs);
    this.booksTimer = window.setInterval(() => {
      void this.pollBooks();
    }, this.booksIntervalMs);
  }

  stop(): void {
    this.running = false;

    if (this.positionsTimer !== null) {
      window.clearInterval(this.positionsTimer);
      this.positionsTimer = null;
    }

    if (this.booksTimer !== null) {
      window.clearInterval(this.booksTimer);
      this.booksTimer = null;
    }
  }

  refresh(): void {
    if (!this.running) {
      return;
    }
    void this.pollPositions();
    void this.pollBooks();
  }

  subscribe(cb: (snap: Snapshot) => void): () => void {
    this.subscribers.add(cb);
    cb(this.snapshot);

    return () => {
      this.subscribers.delete(cb);
    };
  }

  private async pollPositions(): Promise<void> {
    if (!this.address) {
      return;
    }

    const epoch = ++this.positionsEpoch;
    try {
      const positions = (await getPositions(this.address)).filter((position) => position.size >= 0.01);
      if (!this.running || epoch !== this.positionsEpoch) {
        return; // 已 stop 或被更新的一次轮询取代,丢弃陈旧结果。
      }

      this.errors.positions = null;
      const now = Date.now();
      this.snapshot = {
        ...this.snapshot,
        positions,
        books: this.pruneBooks(positions.map((position) => position.asset)),
        lastUpdated: now,
        // 仅持仓刷新推进 positionsUpdatedAt(与 WsSource 一致);供「跟随持仓刷新」的订阅(如挂单重拉)。
        positionsUpdatedAt: now,
        error: this.combinedError(),
      };
      this.emit();

      // 仅当持仓 token 集合发生变化时才立即补拉一次 books;否则交给独立的 books 定时器,避免请求叠加。
      const assetKey = [...new Set(positions.map((position) => position.asset))].sort().join(',');
      if (assetKey !== this.lastAssetKey) {
        this.lastAssetKey = assetKey;
        void this.pollBooks();
      }
    } catch (error) {
      if (!this.running || epoch !== this.positionsEpoch) {
        return;
      }
      this.setError('positions', error);
    }
  }

  private async pollBooks(): Promise<void> {
    const tokenIds = [...new Set(this.snapshot.positions.map((position) => position.asset))];
    if (tokenIds.length === 0) {
      // 无持仓时清除可能残留的 books 错误,避免 UI 持续显示陈旧的 books 失败信息。
      if (this.errors.books !== null) {
        this.errors.books = null;
        this.snapshot = { ...this.snapshot, books: {}, error: this.combinedError() };
        this.emit();
      }
      return;
    }

    const epoch = ++this.booksEpoch;
    try {
      const books = await getBooks(tokenIds);
      if (!this.running || epoch !== this.booksEpoch) {
        return;
      }

      const byAsset: Record<string, OrderBook> = {};
      for (const book of books) {
        byAsset[book.asset_id] = book;
      }

      this.errors.books = null;
      this.snapshot = {
        ...this.snapshot,
        books: byAsset,
        lastUpdated: Date.now(),
        error: this.combinedError(),
      };
      this.emit();
    } catch (error) {
      if (!this.running || epoch !== this.booksEpoch) {
        return;
      }
      this.setError('books', error);
    }
  }

  private pruneBooks(tokenIds: string[]): Record<string, OrderBook> {
    const keep = new Set(tokenIds);
    const books: Record<string, OrderBook> = {};

    for (const [tokenId, book] of Object.entries(this.snapshot.books)) {
      if (keep.has(tokenId)) {
        books[tokenId] = book;
      }
    }

    return books;
  }

  private setError(pollName: PollName, error: unknown): void {
    this.errors[pollName] = error instanceof Error ? error.message : String(error);
    this.snapshot = {
      ...this.snapshot,
      lastUpdated: Date.now(),
      error: this.combinedError(),
    };
    this.emit();
  }

  private combinedError(): string | null {
    const messages = Object.values(this.errors).filter((message): message is string => Boolean(message));
    return messages.length > 0 ? messages.join(' | ') : null;
  }

  private emit(): void {
    for (const subscriber of this.subscribers) {
      subscriber(this.snapshot);
    }
  }
}
