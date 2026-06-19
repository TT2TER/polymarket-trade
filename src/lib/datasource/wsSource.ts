import { getBooks } from '@/lib/api/clobApi';
import { getPositions } from '@/lib/api/dataApi';
import type { BookLevel, OrderBook } from '@/lib/types';
import type { DataSource, Snapshot } from './types';

const MARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const HEARTBEAT_INTERVAL_MS = 10_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const LAST_TRADE_REFRESH_DELAY_MS = 1_000;

interface WsSourceOptions {
  address: string;
  positionsIntervalMs: number;
}

type ErrorName = 'positions' | 'market';
type MarketSide = 'BUY' | 'SELL';

interface MarketBookMessage {
  event_type: 'book';
  asset_id: string;
  market: string;
  timestamp: string;
  bids: BookLevel[];
  asks: BookLevel[];
}

interface PriceChangeLevel {
  asset_id?: string;
  market?: string;
  price?: string;
  size?: string;
  side?: MarketSide;
}

interface MarketPriceChangeMessage {
  event_type: 'price_change';
  asset_id?: string;
  market?: string;
  timestamp?: string;
  price_changes?: PriceChangeLevel[];
  changes?: PriceChangeLevel[];
}

interface LastTradePriceMessage {
  event_type: 'last_trade_price';
  asset_id?: string;
}

type MarketMessage = MarketBookMessage | MarketPriceChangeMessage | LastTradePriceMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toBookLevels(value: unknown): BookLevel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((level) => {
    if (!isRecord(level)) {
      return [];
    }

    const price = toStringValue(level.price);
    const size = toStringValue(level.size);
    return price !== null && size !== null ? [{ price, size }] : [];
  });
}

function parseMarketMessage(value: unknown): MarketMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const eventType = value.event_type;
  if (eventType === 'book') {
    const assetId = toStringValue(value.asset_id);
    const market = toStringValue(value.market);
    const timestamp = toStringValue(value.timestamp);
    if (assetId === null || market === null || timestamp === null) {
      return null;
    }

    return {
      event_type: 'book',
      asset_id: assetId,
      market,
      timestamp,
      bids: toBookLevels(value.bids),
      asks: toBookLevels(value.asks),
    };
  }

  if (eventType === 'price_change') {
    return {
      event_type: 'price_change',
      asset_id: toStringValue(value.asset_id) ?? undefined,
      market: toStringValue(value.market) ?? undefined,
      timestamp: toStringValue(value.timestamp) ?? undefined,
      price_changes: toPriceChangeLevels(value.price_changes),
      changes: toPriceChangeLevels(value.changes),
    };
  }

  if (eventType === 'last_trade_price') {
    return {
      event_type: 'last_trade_price',
      asset_id: toStringValue(value.asset_id) ?? undefined,
    };
  }

  return null;
}

function toPriceChangeLevels(value: unknown): PriceChangeLevel[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((change) => {
    if (!isRecord(change)) {
      return [];
    }

    const side = change.side === 'BUY' || change.side === 'SELL' ? change.side : undefined;
    return [
      {
        asset_id: toStringValue(change.asset_id) ?? undefined,
        market: toStringValue(change.market) ?? undefined,
        price: toStringValue(change.price) ?? undefined,
        size: toStringValue(change.size) ?? undefined,
        side,
      },
    ];
  });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function samePrice(left: string, right: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? leftNumber === rightNumber : left === right;
}

export class WsSource implements DataSource {
  private readonly address: string;
  private readonly positionsIntervalMs: number;
  private readonly subscribers = new Set<(snap: Snapshot) => void>();
  private positionsTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private lastTradeRefreshTimer: number | null = null;
  private socket: WebSocket | null = null;
  private running = false;
  private positionsEpoch = 0;
  private booksEpoch = 0;
  private connectionEpoch = 0;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  // 合帧:同一动画帧内多条 WS 消息只通知订阅方一次,用最新快照,避免突发行情下每条消息各触发一次同步全树渲染。
  private emitRafHandle: number | null = null;
  private lastAssetKey = '';
  private assetIds = new Set<string>();
  private subscribedAssetIds = new Set<string>();
  private errors: Record<ErrorName, string | null> = {
    positions: null,
    market: null,
  };
  private snapshot: Snapshot = {
    positions: [],
    books: {},
    lastUpdated: 0,
    error: null,
  };

  constructor(options: WsSourceOptions) {
    this.address = options.address;
    this.positionsIntervalMs = options.positionsIntervalMs;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    void this.pollPositions();
    this.positionsTimer = window.setInterval(() => {
      void this.pollPositions();
    }, this.positionsIntervalMs);
  }

  stop(): void {
    this.running = false;
    this.positionsEpoch += 1;
    this.booksEpoch += 1;
    this.connectionEpoch += 1;

    if (this.positionsTimer !== null) {
      window.clearInterval(this.positionsTimer);
      this.positionsTimer = null;
    }

    this.clearHeartbeat();
    this.clearReconnect();
    this.clearLastTradeRefresh();
    this.cancelScheduledEmit();
    this.closeSocket();
  }

  refresh(): void {
    if (!this.running) {
      return;
    }
    // 立即重拉持仓(books 由 WS 实时推送);持仓集合若变化会触发重新订阅。
    void this.pollPositions();
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
        return;
      }

      const nextAssetIds = uniqueSorted(positions.map((position) => position.asset));
      const nextAssetKey = nextAssetIds.join(',');
      const assetsChanged = nextAssetKey !== this.lastAssetKey;
      this.lastAssetKey = nextAssetKey;
      this.assetIds = new Set(nextAssetIds);
      this.errors.positions = null;
      this.snapshot = {
        ...this.snapshot,
        positions,
        books: this.pruneBooks(nextAssetIds),
        lastUpdated: Date.now(),
        error: this.combinedError(),
      };
      this.emit();

      if (assetsChanged) {
        this.handleAssetChange(nextAssetIds);
        void this.fetchInitialBooks(nextAssetIds);
      }
    } catch (error) {
      if (!this.running || epoch !== this.positionsEpoch) {
        return;
      }
      this.setError('positions', error instanceof Error ? error.message : String(error));
    }
  }

  private async fetchInitialBooks(tokenIds: string[]): Promise<void> {
    if (tokenIds.length === 0) {
      return;
    }

    const epoch = ++this.booksEpoch;
    try {
      const books = await getBooks(tokenIds);
      if (!this.running || epoch !== this.booksEpoch) {
        return;
      }

      const byAsset = this.pruneBooks([...this.assetIds]);
      for (const book of books) {
        if (this.assetIds.has(book.asset_id)) {
          byAsset[book.asset_id] = book;
        }
      }

      this.snapshot = {
        ...this.snapshot,
        books: byAsset,
        lastUpdated: Date.now(),
        error: this.combinedError(),
      };
      this.emit();
    } catch {
      // The WebSocket stream is authoritative after subscription; an initial REST miss should not surface as a market error.
    }
  }

  private handleAssetChange(nextAssetIds: string[]): void {
    if (nextAssetIds.length === 0) {
      this.clearReconnect();
      this.clearHeartbeat();
      this.closeSocket();
      this.subscribedAssetIds.clear();
      this.setError('market', null);
      return;
    }

    // 持仓集合变化时全量重连重订阅。market 频道是否支持增量 subscribe/unsubscribe 未经确认,
    // 关闭后重连并用完整 assets_ids 订阅最稳妥(服务端会对每个 asset 回 book 快照)。持仓变动不频繁,重连成本可忽略。
    if (this.socket !== null) {
      this.closeSocket();
    }
    this.ensureConnected();
  }

  private ensureConnected(): void {
    if (!this.running || this.assetIds.size === 0) {
      return;
    }

    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.clearReconnect();
    const socket = new WebSocket(MARKET_WS_URL);
    const epoch = ++this.connectionEpoch;
    this.socket = socket;

    socket.onopen = () => {
      if (!this.running || epoch !== this.connectionEpoch || this.socket !== socket) {
        socket.close();
        return;
      }

      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      this.subscribedAssetIds.clear();
      this.setError('market', null);
      this.startHeartbeat();
      this.sendInitialSubscription();
    };

    socket.onmessage = (event: MessageEvent) => {
      if (!this.running || epoch !== this.connectionEpoch || this.socket !== socket) {
        return;
      }
      this.handleSocketMessage(event.data);
    };

    socket.onerror = () => {
      if (!this.running || epoch !== this.connectionEpoch || this.socket !== socket) {
        return;
      }
      this.handleSocketDisconnect(socket);
      socket.close();
    };

    socket.onclose = () => {
      if (!this.running || epoch !== this.connectionEpoch || this.socket !== socket) {
        return;
      }
      this.handleSocketDisconnect(socket);
    };
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send('PING');
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearLastTradeRefresh(): void {
    if (this.lastTradeRefreshTimer !== null) {
      window.clearTimeout(this.lastTradeRefreshTimer);
      this.lastTradeRefreshTimer = null;
    }
  }

  private closeSocket(): void {
    const socket = this.socket;
    if (socket === null) {
      return;
    }

    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    this.socket = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  private handleSocketDisconnect(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }

    this.socket = null;
    this.subscribedAssetIds.clear();
    this.clearHeartbeat();

    if (!this.running || this.assetIds.size === 0) {
      return;
    }

    this.setError('market', 'reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.running || this.assetIds.size === 0 || this.reconnectTimer !== null) {
      return;
    }

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private sendInitialSubscription(): void {
    const assets = [...this.assetIds];
    if (assets.length === 0) {
      return;
    }

    this.sendJson({ assets_ids: assets, type: 'market' });
    this.subscribedAssetIds = new Set(assets);
  }

  private sendJson(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private handleSocketMessage(data: unknown): void {
    if (data === 'PONG') {
      return;
    }

    if (typeof data !== 'string') {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        this.handleMarketMessage(parseMarketMessage(item));
      }
      return;
    }

    this.handleMarketMessage(parseMarketMessage(parsed));
  }

  private handleMarketMessage(message: MarketMessage | null): void {
    if (message === null) {
      return;
    }

    if (message.event_type === 'book') {
      this.handleBookMessage(message);
      return;
    }

    if (message.event_type === 'price_change') {
      this.handlePriceChangeMessage(message);
      return;
    }

    if (message.event_type === 'last_trade_price' && message.asset_id !== undefined && this.assetIds.has(message.asset_id)) {
      this.schedulePositionsRefresh();
    }
  }

  private handleBookMessage(message: MarketBookMessage): void {
    if (!this.assetIds.has(message.asset_id)) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      books: {
        ...this.snapshot.books,
        [message.asset_id]: {
          market: message.market,
          asset_id: message.asset_id,
          timestamp: message.timestamp,
          bids: message.bids,
          asks: message.asks,
        },
      },
      lastUpdated: Date.now(),
      error: this.combinedError(),
    };
    this.emit();
  }

  private handlePriceChangeMessage(message: MarketPriceChangeMessage): void {
    const changes = message.price_changes ?? message.changes ?? [];
    let books = this.snapshot.books;
    let changed = false;

    for (const change of changes) {
      const assetId = change.asset_id ?? message.asset_id;
      if (
        assetId === undefined ||
        change.price === undefined ||
        change.size === undefined ||
        change.side === undefined ||
        !this.assetIds.has(assetId)
      ) {
        continue;
      }

      const currentBook = books[assetId] ?? {
        market: change.market ?? message.market ?? '',
        asset_id: assetId,
        timestamp: message.timestamp ?? String(Date.now()),
        bids: [],
        asks: [],
      };
      const nextBook = this.applyPriceChange(currentBook, {
        assetId,
        market: change.market ?? message.market,
        price: change.price,
        size: change.size,
        side: change.side,
        timestamp: message.timestamp,
      });
      books = { ...books, [assetId]: nextBook };
      changed = true;
    }

    if (!changed) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      books,
      lastUpdated: Date.now(),
      error: this.combinedError(),
    };
    this.emit();
  }

  private applyPriceChange(
    book: OrderBook,
    change: {
      assetId: string;
      market?: string;
      price: string;
      size: string;
      side: MarketSide;
      timestamp?: string;
    },
  ): OrderBook {
    const bids = [...book.bids];
    const asks = [...book.asks];
    const levels = change.side === 'BUY' ? bids : asks;
    const existingIndex = levels.findIndex((level) => samePrice(level.price, change.price));
    const size = Number(change.size);

    if (Number.isFinite(size) && size > 0) {
      const nextLevel = { price: change.price, size: change.size };
      if (existingIndex >= 0) {
        levels[existingIndex] = nextLevel;
      } else {
        levels.push(nextLevel);
      }
    } else if (existingIndex >= 0) {
      levels.splice(existingIndex, 1);
    }

    return {
      market: change.market ?? book.market,
      asset_id: change.assetId,
      timestamp: change.timestamp ?? book.timestamp,
      bids,
      asks,
    };
  }

  private schedulePositionsRefresh(): void {
    if (this.lastTradeRefreshTimer !== null) {
      return;
    }

    this.lastTradeRefreshTimer = window.setTimeout(() => {
      this.lastTradeRefreshTimer = null;
      void this.pollPositions();
    }, LAST_TRADE_REFRESH_DELAY_MS);
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

  private setError(errorName: ErrorName, message: string | null): void {
    if (this.errors[errorName] === message) {
      return;
    }

    this.errors[errorName] = message;
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
    if (!this.running || this.emitRafHandle !== null) {
      return;
    }

    // 合帧:把这一帧内的多次状态变更折叠为一次订阅通知,在下一帧用最新快照刷新。
    // 对眼睛仍是「瞬时」(≤16ms),但把渲染次数钉死在帧率,消除急涨急跌时的渲染抖动。
    this.emitRafHandle = requestAnimationFrame(() => {
      this.emitRafHandle = null;
      if (!this.running) {
        return;
      }
      const snapshot = this.snapshot;
      for (const subscriber of this.subscribers) {
        subscriber(snapshot);
      }
    });
  }

  private cancelScheduledEmit(): void {
    if (this.emitRafHandle !== null) {
      cancelAnimationFrame(this.emitRafHandle);
      this.emitRafHandle = null;
    }
  }
}
