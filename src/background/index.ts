// ⚠ 必须最先导入:在 clob-client / ethers 求值前修正 service worker 的环境探测。
import './swEnv';

import { decryptPrivateKey, encryptPrivateKey, normalizePrivateKey } from '@/lib/crypto/keyStore';
import {
  cacheSession,
  clearSession,
  clearVault,
  hasEncryptedKey,
  loadEncryptedKey,
  readSession,
  saveEncryptedKey,
} from '@/lib/crypto/vault';
import { deriveAddress, deriveCreds, getAuthedClient } from '@/lib/trading/clobClient';
import { placeSell, prepareSellOrder, type PlaceSellParams } from '@/lib/trading/orders';
import { readConfig } from '@/shared/config';
import type { AuthStatusResponse, RuntimeMessage, PongResponse } from '@/shared/messages';
import { readStopLossConfigs } from '@/shared/stopLossConfig';
import type { ClobClient, TickSize } from '@polymarket/clob-client-v2';

const MIN_PASSWORD_LENGTH = 8;
const tickSizeCache = new Map<string, TickSize>();

// 待确认订单:PREPARE_ORDER 生成一次性 nonce,CONFIRM_ORDER 凭 nonce 才真正提交。
// 确认在后台强制(而非仅 UI 约定),且 nonce 一次性 + 限时,降低误发/重放风险(H2)。
const PENDING_ORDER_TTL_MS = 120_000;
const pendingOrders = new Map<string, { params: PlaceSellParams; createdAt: number }>();

// 后台层止损冷却:面板 monitor 的冷却仅在面板内存,后台据此防止重放消息在冷却期内连发真实卖出(H1)。
const STOP_LOSS_BG_COOLDOWN_MS = 60_000;
const stopLossCooldownUntil = new Map<string, number>();

function prunePendingOrders(): void {
  const now = Date.now();
  for (const [nonce, entry] of pendingOrders) {
    if (now - entry.createdAt > PENDING_ORDER_TTL_MS) {
      pendingOrders.delete(nonce);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 解锁:私钥进会话(可签名);尝试派生 CLOB 凭据,成功才算 authenticated。
// 凭据派生失败不致命(钱包仍解锁),authenticated 由会话中是否有 creds 实时反映。
async function unlockWithKey(privateKey: string): Promise<void> {
  const signerAddress = deriveAddress(privateKey);
  try {
    const creds = await deriveCreds(privateKey);
    await cacheSession({
      privateKey,
      signerAddress,
      creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
    });
  } catch (error) {
    console.error('[bg] API credential derivation failed', errorMessage(error));
    await cacheSession({ privateKey, signerAddress });
  }
}

async function getTradingClient(): Promise<ClobClient> {
  const [session, config] = await Promise.all([readSession(), readConfig()]);
  if (!session?.privateKey || !session.creds) {
    throw new Error('Please unlock and complete CLOB authentication first');
  }
  if (!config.address) {
    throw new Error('Set proxy wallet address in settings before trading.');
  }

  return getAuthedClient(session.privateKey, session.creds, config.address);
}

async function getCachedTickSize(client: ClobClient, tokenID: string): Promise<TickSize> {
  const cached = tickSizeCache.get(tokenID);
  if (cached) {
    return cached;
  }

  const tickSize = await client.getTickSize(tokenID);
  tickSizeCache.set(tokenID, tickSize);
  return tickSize;
}

async function buildPlaceSellParams(client: ClobClient, message: Extract<RuntimeMessage, { type: 'PREPARE_ORDER' }>): Promise<PlaceSellParams> {
  const config = await readConfig();
  const tickSize = await getCachedTickSize(client, message.tokenID);

  return {
    tokenID: message.tokenID,
    mode: message.mode,
    price: message.price,
    size: message.size,
    n: message.n,
    negRisk: message.negRisk,
    avgPrice: message.avgPrice,
    positionSize: message.positionSize,
    bestBid: message.bestBid,
    bestAsk: message.bestAsk,
    tickSize,
    dryRun: config.dryRun,
  };
}

async function buildStopLossSellParams(
  client: ClobClient,
  message: Extract<RuntimeMessage, { type: 'STOP_LOSS_SELL' }>,
): Promise<PlaceSellParams> {
  const [config, stopLossConfigs] = await Promise.all([readConfig(), readStopLossConfigs()]);
  const tickSize = await getCachedTickSize(client, message.tokenID);
  // 滑点优先用该仓自己的设置;未设(null)则退回全局默认。
  const perPosition = stopLossConfigs[message.tokenID]?.slippage;
  const slippage = perPosition != null ? perPosition : config.stopLossSlippage;

  return {
    tokenID: message.tokenID,
    mode: 'taker',
    price: message.bestBid,
    size: message.qty,
    negRisk: message.negRisk,
    avgPrice: message.avgPrice,
    positionSize: message.positionSize,
    bestBid: message.bestBid,
    tickSize,
    dryRun: config.dryRun,
    // 止损滑点:向下扫单,确保急跌/深砸时也能及时成交而非被 Kill。
    slippage,
  };
}

// 点击扩展图标时打开 Side Panel(多持仓监控面板)。
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[bg] setPanelBehavior failed', err));
});

// 消息路由。所有异步处理器都 return true 保持通道开启,并在 settle 后调用 sendResponse。
chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'ping': {
      const res: PongResponse = { type: 'pong', ts: Date.now() };
      sendResponse(res);
      return true;
    }
    case 'IMPORT_KEY': {
      void (async () => {
        try {
          if (message.password.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
          }
          const privateKey = normalizePrivateKey(message.privateKey);
          const encryptedBlob = await encryptPrivateKey(privateKey, message.password);
          await saveEncryptedKey(encryptedBlob);
          await unlockWithKey(privateKey);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'UNLOCK': {
      void (async () => {
        try {
          const encryptedBlob = await loadEncryptedKey();
          if (encryptedBlob === null) {
            throw new Error('No encrypted key is stored.');
          }
          const privateKey = await decryptPrivateKey(encryptedBlob, message.password);
          await unlockWithKey(privateKey);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'LOCK': {
      void (async () => {
        try {
          await clearSession();
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'FORGET_KEY': {
      void (async () => {
        try {
          await clearVault();
          await clearSession();
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'GET_AUTH_STATUS': {
      void (async () => {
        try {
          // 状态实时由会话存在与否派生,避免模块级标志在 SW 重启或会话被外部清除后陈旧。
          const session = await readSession();
          const res: AuthStatusResponse = {
            hasKey: await hasEncryptedKey(),
            unlocked: session !== null,
            authenticated: Boolean(session?.creds),
            signerAddress: session?.signerAddress,
          };
          sendResponse(res);
        } catch (error) {
          console.error('[bg] GET_AUTH_STATUS failed', errorMessage(error));
          sendResponse({ hasKey: false, unlocked: false, authenticated: false });
        }
      })();
      return true;
    }
    case 'PREPARE_ORDER': {
      void (async () => {
        try {
          const [client, config] = await Promise.all([getTradingClient(), readConfig()]);
          const params = await buildPlaceSellParams(client, message);
          const prepared = prepareSellOrder(params);
          if (prepared.estAmount > config.maxOrderUsd) {
            throw new Error(
              `Order estimate $${prepared.estAmount.toFixed(2)} exceeds max single-order cap $${config.maxOrderUsd.toFixed(2)}.`,
            );
          }

          prunePendingOrders();
          const nonce = crypto.randomUUID();
          pendingOrders.set(nonce, { params, createdAt: Date.now() });
          sendResponse({
            ok: true,
            data: {
              nonce,
              preview: {
                mode: params.mode,
                price: prepared.userOrder.price,
                size: prepared.userOrder.size,
                estAmount: prepared.estAmount,
                orderType: prepared.orderType,
                postOnly: prepared.postOnly,
                dryRun: params.dryRun,
                warning: prepared.warning,
                remaining: prepared.remaining,
              },
            },
          });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'CONFIRM_ORDER': {
      void (async () => {
        try {
          prunePendingOrders();
          const entry = pendingOrders.get(message.nonce);
          // 一次性消费 nonce:无论成功失败都移除,杜绝重放。
          pendingOrders.delete(message.nonce);
          if (!entry) {
            throw new Error('Order confirmation expired or not found. Please review and confirm again.');
          }

          const [client, config] = await Promise.all([getTradingClient(), readConfig()]);
          // 提交前以最新 config 重新校验上限(确认窗口期间用户可能调过设置)。
          const prepared = prepareSellOrder(entry.params);
          if (prepared.estAmount > config.maxOrderUsd) {
            throw new Error(
              `Order estimate $${prepared.estAmount.toFixed(2)} exceeds max single-order cap $${config.maxOrderUsd.toFixed(2)}.`,
            );
          }

          sendResponse({ ok: true, data: await placeSell(client, entry.params) });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'STOP_LOSS_SELL': {
      void (async () => {
        try {
          const stopLossConfigs = await readStopLossConfigs();
          if (!stopLossConfigs[message.tokenID]?.armed) {
            throw new Error('Stop-loss is not armed for this asset.');
          }

          // H2:卖出量必须为正且不超过声明的持仓量,拒绝篡改/陈旧的超额 qty。
          const declaredSize = message.positionSize;
          if (!(message.qty > 0) || typeof declaredSize !== 'number' || message.qty > declaredSize) {
            throw new Error('Invalid stop-loss quantity.');
          }

          const now = Date.now();
          const [client, config] = await Promise.all([getTradingClient(), readConfig()]);

          // H1:仅对真实提交施加后台冷却(dry-run 模拟不受限,便于测试)。
          if (!config.dryRun && (stopLossCooldownUntil.get(message.tokenID) ?? 0) > now) {
            throw new Error('Stop-loss cooldown active for this asset.');
          }

          const params = await buildStopLossSellParams(client, message);
          const prepared = prepareSellOrder(params);
          if (prepared.estAmount > config.stopLossMaxUsd) {
            throw new Error(
              `Stop-loss estimate $${prepared.estAmount.toFixed(2)} exceeds stop-loss cap $${config.stopLossMaxUsd.toFixed(2)}.`,
            );
          }

          const result = await placeSell(client, params);
          if (!config.dryRun) {
            stopLossCooldownUntil.set(message.tokenID, now + STOP_LOSS_BG_COOLDOWN_MS);
          }
          sendResponse({ ok: true, data: result });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'GET_OPEN_ORDERS': {
      void (async () => {
        try {
          const client = await getTradingClient();
          const orders = await client.getOpenOrders(message.asset ? { asset_id: message.asset } : undefined);
          sendResponse({ ok: true, data: orders });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'CANCEL_ORDER': {
      void (async () => {
        try {
          const client = await getTradingClient();
          sendResponse({ ok: true, data: await client.cancelOrder({ orderID: message.orderID }) });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    case 'CANCEL_ALL': {
      void (async () => {
        try {
          const client = await getTradingClient();
          // 仅撤销该持仓(asset)的挂单,不做全账户无差别撤单(L2)。
          const orders = await client.getOpenOrders({ asset_id: message.asset });
          const orderIDs = orders.map((order) => order.id);
          sendResponse({ ok: true, data: orderIDs.length > 0 ? await client.cancelOrders(orderIDs) : { cancelled: [] } });
        } catch (error) {
          sendResponse({ error: errorMessage(error) });
        }
      })();
      return true;
    }
    default:
      return false;
  }
});

console.log('[bg] Polymarket 持仓助手 service worker 已启动');
