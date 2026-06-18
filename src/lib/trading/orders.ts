import { OrderType, Side, type ClobClient, type TickSize, type UserOrderV2 } from '@polymarket/clob-client-v2';

export type PlaceSellMode = 'maker' | 'taker' | 'limitN' | 'nxCost';

export interface PlaceSellParams {
  tokenID: string;
  mode: PlaceSellMode;
  tickSize: TickSize;
  dryRun: boolean;
  price?: number;
  size?: number;
  n?: number;
  negRisk?: boolean;
  avgPrice?: number;
  positionSize?: number;
  bestBid?: number;
  bestAsk?: number;
  // 止损卖单滑点容忍(0~1):taker 限价 = bestBid×(1−slippage),向下扫单确保成交。仅止损路径传入。
  slippage?: number;
}

export interface PreparedSellOrder {
  userOrder: UserOrderV2;
  orderType: OrderType;
  postOnly: boolean;
  estAmount: number;
  tickSize: TickSize;
  negRisk?: boolean;
  warning?: string;
  remaining?: number;
}

export interface PlaceSellResult {
  dryRun: boolean;
  mode: PlaceSellMode;
  tokenID: string;
  price: number;
  size: number;
  estAmount: number;
  orderType: OrderType;
  postOnly: boolean;
  tickSize: TickSize;
  negRisk?: boolean;
  warning?: string;
  remaining?: number;
  signedPreview?: {
    signed: true;
    signatureHidden: true;
  };
  orderID?: string;
  status?: string;
  takingAmount?: string;
  makingAmount?: string;
  transactionsHashes?: string[];
}

// clob-client 对卖单 size 向下取整到 2 位小数;本地保持一致,避免签名后数量与预期/上限不符(M4)。
const SHARE_PRECISION = 100;

function finitePositive(value: number | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  return value;
}

function tickDecimals(tickSize: TickSize): number {
  const [, decimals = ''] = tickSize.split('.');
  return decimals.length;
}

export function roundDownShares(value: number): number {
  return Math.floor(value * SHARE_PRECISION + 1e-9) / SHARE_PRECISION;
}

function readResponseField(response: unknown, field: string): unknown {
  if (typeof response !== 'object' || response === null || !(field in response)) {
    return undefined;
  }

  return (response as Record<string, unknown>)[field];
}

// clob-client 默认 throwOnError=false,失败时返回错误对象而非抛错。
// 这里显式校验:success===false / 非空 errorMsg / error 字段都视为失败并抛出(H1)。
function assertOrderAccepted(response: unknown): void {
  const success = readResponseField(response, 'success');
  const errorMsg = readResponseField(response, 'errorMsg');
  const error = readResponseField(response, 'error');

  if (success === false || (typeof errorMsg === 'string' && errorMsg.length > 0) || (typeof error === 'string' && error.length > 0)) {
    const reason =
      (typeof errorMsg === 'string' && errorMsg) || (typeof error === 'string' && error) || 'Order was rejected by the exchange.';
    throw new Error(reason);
  }
}

export function roundToTick(price: number, tickSize: TickSize): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }

  const tick = Number(tickSize);
  const decimals = tickDecimals(tickSize);
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}

// 卖出限价向上取整到 tick:用于「n 倍价挂单」,确保挂单价不低于目标 n×均价(M2)。
export function ceilToTick(price: number, tickSize: TickSize): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  const tick = Number(tickSize);
  const decimals = tickDecimals(tickSize);
  return Number((Math.ceil(price / tick) * tick).toFixed(decimals));
}

// 向下取整到 tick:用于止损卖单的滑点限价,确保限价 ≤ 目标价、可向下扫单成交。
export function floorToTick(price: number, tickSize: TickSize): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  const tick = Number(tickSize);
  const decimals = tickDecimals(tickSize);
  return Number((Math.floor(price / tick) * tick).toFixed(decimals));
}

// clob-client 接受的最高限价为 1 - tickSize。
export function maxLimitPrice(tickSize: TickSize): number {
  return Number((1 - Number(tickSize)).toFixed(tickDecimals(tickSize)));
}

export function computeNxCostQuantity(
  avg: number,
  size: number,
  price: number,
  n: number,
): { qty: number; capped: boolean; estCash: number; remaining: number } {
  if (![avg, size, price, n].every((value) => Number.isFinite(value) && value > 0)) {
    // 非法输入返回安全零值(L3:size 为 NaN 时不可返回 NaN remaining)。
    return { qty: 0, capped: false, estCash: 0, remaining: Number.isFinite(size) ? Math.max(0, size) : 0 };
  }

  const rawQty = (n * avg * size) / price;
  const capped = rawQty > size;
  const qty = roundDownShares(Math.min(rawQty, size));
  const remaining = Math.max(0, roundDownShares(size - qty));

  return {
    qty,
    capped,
    estCash: qty * price,
    remaining,
  };
}

export function prepareSellOrder(params: PlaceSellParams): PreparedSellOrder {
  const tokenID = params.tokenID.trim();
  if (!tokenID) {
    throw new Error('tokenID is required.');
  }

  const positionSize = params.positionSize;
  let price: number;
  let size: number;
  let orderType = OrderType.GTC;
  let postOnly = false;
  let warning: string | undefined;
  let remaining: number | undefined;

  switch (params.mode) {
    case 'maker': {
      price = finitePositive(params.price ?? params.bestAsk, 'Maker price');
      size = finitePositive(params.size ?? positionSize, 'Order size');
      const bestBid = params.bestBid ?? 0;
      // 严格大于最优买价以避免穿价(M3);postOnly 仍作为服务端兜底,穿价会被拒而非成交。
      if (bestBid > 0 && price <= bestBid) {
        throw new Error('Maker sell price must be strictly greater than best bid to avoid crossing.');
      }
      if (price > maxLimitPrice(params.tickSize)) {
        throw new Error(`Maker price exceeds max ${maxLimitPrice(params.tickSize)}.`);
      }
      orderType = OrderType.GTC;
      postOnly = true;
      break;
    }
    case 'taker': {
      const rawPrice = finitePositive(params.price ?? params.bestBid, 'Best bid');
      // 止损滑点:限价下移到 bestBid×(1−slippage) 并向下取整到 tick,FAK 向下扫多档确保成交。
      const slippage = typeof params.slippage === 'number' && params.slippage > 0 ? Math.min(params.slippage, 0.99) : 0;
      const slipped = slippage > 0 ? floorToTick(rawPrice * (1 - slippage), params.tickSize) : rawPrice;
      // 低价币向下取整可能落到 0:退回原始买价(已是合法 tick),不阻断止损。
      price = slipped > 0 ? slipped : rawPrice;
      size = finitePositive(params.size ?? positionSize, 'Order size');
      orderType = OrderType.FAK;
      break;
    }
    case 'limitN': {
      const avgPrice = finitePositive(params.avgPrice, 'Average price');
      const n = finitePositive(params.n, 'Multiplier');
      // 向上取整到 tick,确保挂单价不低于目标 n×均价(M2)。
      price = ceilToTick(n * avgPrice, params.tickSize);
      if (price > maxLimitPrice(params.tickSize)) {
        throw new Error(`Target price ${(n * avgPrice).toFixed(4)} exceeds max ${maxLimitPrice(params.tickSize)}, unreachable`);
      }
      size = finitePositive(params.size ?? positionSize, 'Order size');
      orderType = OrderType.GTC;
      break;
    }
    case 'nxCost': {
      const avgPrice = finitePositive(params.avgPrice, 'Average price');
      const fullSize = finitePositive(positionSize, 'Position size');
      const n = finitePositive(params.n, 'Multiplier');
      price = finitePositive(params.bestBid ?? params.price, 'Best bid');
      const computed = computeNxCostQuantity(avgPrice, fullSize, price, n);
      if (computed.qty <= 0) {
        throw new Error('Computed sell quantity is zero.');
      }
      size = computed.qty;
      warning = computed.capped ? 'Selling full position still insufficient for n× cost' : undefined;
      remaining = computed.remaining;
      orderType = OrderType.FAK;
      break;
    }
    default: {
      const exhaustive: never = params.mode;
      throw new Error(`Unsupported sell mode: ${exhaustive}`);
    }
  }

  const userOrder: UserOrderV2 = {
    tokenID,
    price,
    size,
    side: Side.SELL,
  };

  return {
    userOrder,
    orderType,
    postOnly,
    estAmount: price * size,
    tickSize: params.tickSize,
    negRisk: params.negRisk,
    warning,
    remaining,
  };
}

export async function placeSell(client: ClobClient, params: PlaceSellParams): Promise<PlaceSellResult> {
  const prepared = prepareSellOrder(params);
  const options = { tickSize: prepared.tickSize, negRisk: prepared.negRisk };
  const baseResult = {
    dryRun: params.dryRun,
    mode: params.mode,
    tokenID: prepared.userOrder.tokenID,
    price: prepared.userOrder.price,
    size: prepared.userOrder.size,
    estAmount: prepared.estAmount,
    orderType: prepared.orderType,
    postOnly: prepared.postOnly,
    tickSize: prepared.tickSize,
    negRisk: prepared.negRisk,
    warning: prepared.warning,
    remaining: prepared.remaining,
  };

  if (params.dryRun) {
    // 仅本地构建+签名,不提交(预览用)。
    await client.createOrder(prepared.userOrder, options);
    return {
      ...baseResult,
      signedPreview: { signed: true, signatureHidden: true },
    };
  }

  // V2:统一 createOrder + postOrder,可同时处理 GTC(maker/limitN)与 FAK(taker/nxCost)——
  // createAndPostOrder 仅支持 GTC/GTD,不能用于 FAK。
  // ⚠ V2 postOrder 参数序为 (order, orderType, postOnly, deferExec)(与 V1 的 deferExec/postOnly 顺序相反)。
  const signed = await client.createOrder(prepared.userOrder, options);
  const response = await client.postOrder(signed, prepared.orderType, prepared.postOnly, false);

  // 失败响应不得被当作成功(H1)。
  assertOrderAccepted(response);

  const orderID = readResponseField(response, 'orderID');
  const status = readResponseField(response, 'status');
  const takingAmount = readResponseField(response, 'takingAmount');
  const makingAmount = readResponseField(response, 'makingAmount');
  const transactionsHashes = readResponseField(response, 'transactionsHashes');

  // 只回传白名单字段,不回传原始响应(L1)。
  return {
    ...baseResult,
    orderID: typeof orderID === 'string' ? orderID : undefined,
    status: typeof status === 'string' ? status : undefined,
    takingAmount: typeof takingAmount === 'string' ? takingAmount : undefined,
    makingAmount: typeof makingAmount === 'string' ? makingAmount : undefined,
    transactionsHashes: Array.isArray(transactionsHashes) ? transactionsHashes.filter((item): item is string => typeof item === 'string') : undefined,
  };
}
