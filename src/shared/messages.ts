/**
 * 后台 Service Worker 与 Side Panel UI 之间的消息协议。
 * 后续阶段在此扩展(持仓推送、下单指令、止损配置等)。
 */

import type { OpenOrder } from '@polymarket/clob-client-v2';
import type { PlaceSellMode, PlaceSellResult } from '@/lib/trading/orders';

export type PingMessage = { type: 'ping' };

export interface ImportKeyRequest {
  type: 'IMPORT_KEY';
  privateKey: string;
  password: string;
}

export interface UnlockRequest {
  type: 'UNLOCK';
  password: string;
}

export interface LockRequest {
  type: 'LOCK';
}

export interface ForgetKeyRequest {
  type: 'FORGET_KEY';
}

export interface GetAuthStatusRequest {
  type: 'GET_AUTH_STATUS';
}

// 第一步:后台据此构建+校验订单并返回一次性 nonce + 预览(不提交)。
export interface PrepareOrderRequest {
  type: 'PREPARE_ORDER';
  tokenID: string;
  mode: PlaceSellMode;
  price?: number;
  size?: number;
  n?: number;
  negRisk?: boolean;
  avgPrice?: number;
  positionSize?: number;
  bestBid?: number;
  bestAsk?: number;
}

// 第二步:仅凭后台发放的 nonce 才能真正提交(确认在后台强制,而非仅 UI 约定)。
export interface ConfirmOrderRequest {
  type: 'CONFIRM_ORDER';
  nonce: string;
}

export interface OrderPreview {
  mode: PlaceSellMode;
  price: number;
  size: number;
  estAmount: number;
  orderType: string;
  postOnly: boolean;
  dryRun: boolean;
  warning?: string;
  remaining?: number;
}

export interface GetOpenOrdersRequest {
  type: 'GET_OPEN_ORDERS';
  asset?: string;
}

export interface CancelOrderRequest {
  type: 'CANCEL_ORDER';
  orderID: string;
}

// asset 必填:仅撤销该持仓的挂单,不提供无差别的全账户撤单(L2)。
export interface CancelAllRequest {
  type: 'CANCEL_ALL';
  asset: string;
}

// 全账户撤单(破坏性):走 client.cancelAll(),与 per-asset 的 CANCEL_ALL 区分。
export interface CancelAllGlobalRequest {
  type: 'CANCEL_ALL_GLOBAL';
}

export interface StopLossSellRequest {
  type: 'STOP_LOSS_SELL';
  tokenID: string;
  qty: number;
  bestBid: number;
  negRisk?: boolean;
  avgPrice?: number;
  positionSize?: number;
}

// #6 条件单/OCO 触发的自动卖出。结构同止损,但后台据「条件单已武装」而非「止损已武装」校验。
export interface ConditionalSellRequest {
  type: 'CONDITIONAL_SELL';
  tokenID: string;
  qty: number;
  bestBid: number;
  negRisk?: boolean;
  avgPrice?: number;
  positionSize?: number;
}

export interface AuthStatusResponse {
  hasKey: boolean;
  // 钱包私钥是否已解密进会话(可签名)。
  unlocked: boolean;
  // 是否已成功派生 CLOB L2 API 凭据(P3 下单的前置条件)。可能 unlocked=true 但 authenticated=false。
  authenticated: boolean;
  // 由私钥派生的签名者(Magic EOA)地址,供用户核对;注意它 ≠ funder/代理钱包地址。
  signerAddress?: string;
}

export interface OkResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}

export interface PrepareOrderOkResponse {
  ok: true;
  data: { nonce: string; preview: OrderPreview };
}

export interface PlaceOrderOkResponse {
  ok: true;
  data: PlaceSellResult;
}

export interface GetOpenOrdersOkResponse {
  ok: true;
  data: OpenOrder[];
}

export interface TradingOkResponse {
  ok: true;
  data?: unknown;
}

export type RuntimeMessage =
  | PingMessage
  | ImportKeyRequest
  | UnlockRequest
  | LockRequest
  | ForgetKeyRequest
  | GetAuthStatusRequest
  | PrepareOrderRequest
  | ConfirmOrderRequest
  | StopLossSellRequest
  | ConditionalSellRequest
  | GetOpenOrdersRequest
  | CancelOrderRequest
  | CancelAllRequest
  | CancelAllGlobalRequest;

export type PongResponse = { type: 'pong'; ts: number };
