export interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  redeemable: boolean;
  title: string;
  slug: string;
  icon: string;
  eventId: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}

export interface BookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  timestamp: string;
  bids: BookLevel[];
  asks: BookLevel[];
  tick_size?: string;
  neg_risk?: boolean;
}

export interface TargetPrice {
  multiple: number;
  price: number;
  reachable: boolean;
}

export interface PositionView {
  position: Position;
  book: OrderBook | null;
  bestBid: number;
  bestAsk: number;
  currentPrice: number;
  positionValue: number;
  impliedProbability: number;
  unrealizedPnlAbsolute: number;
  unrealizedPnlPercent: number;
  targetPrices: TargetPrice[];
  lastUpdated: number;
}
