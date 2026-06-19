/**
 * Deposit-wallet 实盘下单诊断脚本(独立运行,不动扩展代码)
 *
 * 严格依据官方文档 https://docs.polymarket.com/trading/deposit-wallets
 * 的 6 步流程(Owner signer → 部署 → 充值 → 授权 → 同步余额 → POLY_1271 下单)。
 * 本脚本只覆盖「已通过 UI 完成部署/充值/授权」之后的验证部分:
 *   Phase 1  身份与链上诊断(只读):派生 EOA、检查 funder 是否已部署、判别钱包类型
 *   Phase 2  CLOB L1 鉴权:createOrDeriveApiKey(按文档/ts-sdk#73,API key 绑 EOA 是设计如此)
 *   Phase 3  关键判定:逐个签名类型探测 getBalanceAllowance —— 只有正确的签名类型会返回真实余额
 *   Phase 4 (可选,需 PLACE_ORDER=true):挂一笔远离市价、绝不成交的小单并立即撤销,验证端到端
 *
 * 运行:
 *   1) 复制 scripts/deposit-wallet.env.example 为 scripts/.env 并填入 PRIVATE_KEY
 *   2) node --env-file=scripts/.env scripts/test-deposit-wallet.mjs
 *
 * ⚠ PRIVATE_KEY 只在本机使用,绝不要提交或外传。
 */

import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
} from '@polymarket/clob-client-v2';
import { createPublicClient, createWalletClient, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

// ---------- 配置(可被环境变量覆盖) ----------
const PRIVATE_KEY = process.env.PRIVATE_KEY;
// 个人资料页「仅供 API 使用、请勿向此地址发送资金」的地址 = V2 交易代理 = funder(deposit wallet)
const FUNDER = (process.env.FUNDER || '0x4CFd6C92566969FFEb94bc8636c3779AcC0A2dED').toLowerCase();
// relayer 密钥页面的 RELAYER_API_KEY_ADDRESS,用来核对它是否就是私钥派生出的 EOA
const EXPECTED_EOA = (process.env.EXPECTED_EOA || '0x4745a326D20bfE33E5e119713ce49B4343055f6a').toLowerCase();
const CLOB_API_URL = process.env.CLOB_API_URL || 'https://clob.polymarket.com';
const RPC_URL = process.env.RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
const CHAIN_ID = Number(process.env.CHAIN_ID || 137);

// 可选:直接复用已有 CLOB 凭据(跳过 Phase 2 的 createOrDeriveApiKey)
const ENV_CREDS =
  process.env.CLOB_API_KEY && process.env.CLOB_SECRET && process.env.CLOB_PASS_PHRASE
    ? {
        key: process.env.CLOB_API_KEY,
        secret: process.env.CLOB_SECRET,
        passphrase: process.env.CLOB_PASS_PHRASE,
      }
    : null;

// 可选 Phase 4
const PLACE_ORDER = process.env.PLACE_ORDER === 'true';
const TOKEN_ID = process.env.TOKEN_ID || '';
const ORDER_SIDE = (process.env.ORDER_SIDE || 'BUY').toUpperCase() === 'SELL' ? Side.SELL : Side.BUY;
const ORDER_PRICE = Number(process.env.ORDER_PRICE || 0.02); // 远离市价、保证不成交
const ORDER_SIZE = Number(process.env.ORDER_SIZE || 5);

const mask = (s) => (s ? `${String(s).slice(0, 6)}…${String(s).slice(-4)}` : '(空)');
const line = (t = '') => console.log(t);
const head = (t) => console.log(`\n===== ${t} =====`);

function normalizePk(pk) {
  return `0x${String(pk).trim().replace(/^0x/i, '')}`;
}

function makeWalletClient() {
  const account = privateKeyToAccount(normalizePk(PRIVATE_KEY));
  const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
  return { account, walletClient };
}

function makeClob({ walletClient, creds, signatureType }) {
  return new ClobClient({
    host: CLOB_API_URL,
    chain: CHAIN_ID,
    signer: walletClient,
    ...(creds ? { creds } : {}),
    ...(signatureType !== undefined ? { signatureType } : {}),
    funderAddress: FUNDER,
  });
}

async function main() {
  if (!PRIVATE_KEY) {
    line('✗ 缺少 PRIVATE_KEY。请在 scripts/.env 填入从 reveal.magic.link 导出的私钥后再运行。');
    process.exit(1);
  }
  if (!isAddress(FUNDER)) {
    line(`✗ FUNDER 不是合法地址: ${FUNDER}`);
    process.exit(1);
  }

  // ---------------- Phase 1:身份 + 链上诊断(只读) ----------------
  head('Phase 1 · 身份与链上诊断(只读)');
  const { account, walletClient } = makeWalletClient();
  const eoa = account.address.toLowerCase();
  line(`私钥派生 EOA(signer)   : ${account.address}`);
  line(`funder(deposit wallet) : ${FUNDER}`);
  line(`RELAYER_API_KEY_ADDRESS: ${EXPECTED_EOA}`);
  line(
    eoa === EXPECTED_EOA
      ? '  ✓ EOA == RELAYER_API_KEY_ADDRESS(私钥就是 relayer/owner 那把 key)'
      : '  ⚠ EOA ≠ RELAYER_API_KEY_ADDRESS。说明私钥派生地址与 relayer 地址不同,后面以 EOA 为准。',
  );
  if (eoa === FUNDER) {
    line('  ⚠ EOA 与 funder 相同 —— 这通常不对(funder 应是合约钱包,EOA 是签名者)。');
  }

  const pub = createPublicClient({ chain: polygon, transport: http(RPC_URL) });
  let funderDeployed = false;
  try {
    const code = await pub.getCode({ address: FUNDER });
    funderDeployed = !!code && code !== '0x';
    line(`\nfunder 链上字节码        : ${funderDeployed ? `${(code.length - 2) / 2} 字节(已部署 ✓)` : '空(未部署 ✗)'}`);
    if (!funderDeployed) {
      line('  ✗ deposit wallet 还没上链。按文档需先用 relayer WALLET-CREATE 部署,');
      line('    或直接在 Polymarket 官网 UI 手动下 1 笔小单触发部署,然后再跑本脚本。');
    }
  } catch (e) {
    line(`  ⚠ 读取字节码失败(RPC 问题?):${e.shortMessage || e.message}`);
  }

  // 粗判钱包类型:Gnosis Safe 有 getOwners()/getThreshold();1271/proxy 多半有 owner()
  if (funderDeployed) {
    const tryRead = async (abi, functionName) => {
      try {
        return await pub.readContract({ address: FUNDER, abi, functionName });
      } catch {
        return undefined;
      }
    };
    const owner = await tryRead([{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], 'owner');
    const owners = await tryRead([{ name: 'getOwners', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] }], 'getOwners');
    const safeVersion = await tryRead([{ name: 'VERSION', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }], 'VERSION');
    line('链上类型探测:');
    if (owners) line(`  · getOwners() = ${owners.join(', ')}  → 像 Gnosis Safe(签名类型应为 2 POLY_GNOSIS_SAFE)`);
    if (safeVersion) line(`  · Safe VERSION() = ${safeVersion}`);
    if (owner) line(`  · owner() = ${owner}  → 像 1271/proxy(邮箱账户多为 3 POLY_1271)`);
    if (!owner && !owners) line('  · owner()/getOwners() 都没响应,无法从这两个函数判型,以 Phase 3 的余额探测为准。');
  }

  // ---------------- Phase 2:CLOB L1 鉴权 ----------------
  head('Phase 2 · CLOB L1 鉴权(获取 API 凭据)');
  let creds = ENV_CREDS;
  if (creds) {
    line(`使用 .env 提供的 CLOB 凭据:key=${mask(creds.key)}`);
  } else {
    try {
      const authClient = makeClob({ walletClient }); // 不带 creds,用于派生
      creds = await authClient.createOrDeriveApiKey();
      line('createOrDeriveApiKey 成功:');
      line(`  key        = ${mask(creds.key || creds.apiKey)}`);
      line(`  secret     = ${mask(creds.secret || creds.apiSecret)}`);
      line(`  passphrase = ${mask(creds.passphrase || creds.apiPassphrase)}`);
      line('  注:按官方文档 + ts-sdk#73,该 API key 绑定 EOA 属设计如此,不是 bug。');
      // 规整字段名
      creds = {
        key: creds.key || creds.apiKey,
        secret: creds.secret || creds.apiSecret,
        passphrase: creds.passphrase || creds.apiPassphrase,
      };
    } catch (e) {
      line(`  ✗ 派生 API key 失败:${e.shortMessage || e.message}`);
      line('    若报与 1271/签名相关,可能是钱包类型不符或私钥不可用(TSS 分片)。');
      process.exit(1);
    }
  }

  // ---------------- Phase 3:逐签名类型探测余额(关键判定) ----------------
  head('Phase 3 · 余额探测 —— 找出正确的签名类型(关键)');
  line('原理(见 issue #56):funder/签名类型配对正确时 getBalanceAllowance 返回真实余额;配错则静默返回 0 或报错。\n');
  const candidates = [
    [SignatureTypeV2.POLY_1271, 'POLY_1271 (3) · 邮箱/Magic deposit wallet'],
    [SignatureTypeV2.POLY_GNOSIS_SAFE, 'POLY_GNOSIS_SAFE (2) · 外部钱包注册'],
    [SignatureTypeV2.POLY_PROXY, 'POLY_PROXY (1) · 老式代理'],
  ];
  let winner = null;
  for (const [sigType, label] of candidates) {
    const clob = makeClob({ walletClient, creds, signatureType: sigType });
    try {
      await clob.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      const ba = await clob.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      const bal = Number(ba.balance ?? ba.balanceAllowance ?? 0);
      const ok = bal > 0;
      line(`  [${label}]`);
      line(`     balance=${ba.balance ?? '?'}  allowances=${JSON.stringify(ba.allowances ?? ba.allowance ?? {})}`);
      if (ok && !winner) winner = { sigType, label, ba };
      line(ok ? '     ✓ 返回非零余额 —— 这很可能就是正确的签名类型' : '     · 余额为 0');
    } catch (e) {
      line(`  [${label}]  ✗ 报错: ${e.shortMessage || e.message}`);
    }
  }

  line('');
  if (winner) {
    line(`✅ 结论:你的账户应使用 signatureType = ${winner.sigType}(${winner.label.split(' · ')[0]}),funder = ${FUNDER}`);
    line('   把扩展里的 SIGNATURE_TYPE 改成这个值即可,createApiKey 绑 EOA 不用动。');
  } else {
    line('❌ 三种签名类型余额都为 0 / 报错。可能原因(按概率):');
    line('   1) deposit wallet 未充值 pUSD(EOA 里的钱不算);');
    line('   2) funder 地址填错(确认就是个人资料页那个「仅供 API 使用」的地址);');
    line('   3) 钱包未部署 / 授权未做(见 Phase 1,先去 UI 下一单或走 relayer 流程);');
    line('   4) 邮箱账户实为 Privy TSS,导出的不是完整私钥(签不出有效签名)。');
  }

  // ---------------- Phase 4:挂单 + 撤单(可选) ----------------
  if (!PLACE_ORDER) {
    head('Phase 4 · 已跳过');
    line('如需端到端验证:设 PLACE_ORDER=true 且提供 TOKEN_ID(会挂一笔远离市价的小单并立即撤销)。');
    line('⚠ 实测下单请直连家庭网络(关掉 v2raya 代理 pon),避免 issue #70 的「出口 IP 被秒撤」。');
    return;
  }
  head('Phase 4 · 挂单 + 撤单(端到端验证)');
  if (!TOKEN_ID) {
    line('✗ PLACE_ORDER=true 但缺少 TOKEN_ID,跳过。');
    return;
  }
  if (!winner) {
    line('✗ Phase 3 未找到有效签名类型(余额均为 0 / 报错),为安全起见不下单,跳过。');
    return;
  }
  const sigType = winner.sigType;
  const clob = makeClob({ walletClient, creds, signatureType: sigType });
  try {
    const tickSize = await clob.getTickSize(TOKEN_ID);
    const negRisk = await clob.getNegRisk(TOKEN_ID);
    line(`tokenID=${TOKEN_ID}  tickSize=${tickSize}  negRisk=${negRisk}`);
    line(`挂单:${ORDER_SIDE} price=${ORDER_PRICE} size=${ORDER_SIZE}(GTC,远离市价不成交)`);
    const resp = await clob.createAndPostOrder(
      { tokenID: TOKEN_ID, price: ORDER_PRICE, size: ORDER_SIZE, side: ORDER_SIDE },
      { tickSize: String(tickSize), negRisk: Boolean(negRisk) },
      OrderType.GTC,
      true, // postOnly:被动挂单,若会穿价则被服务端拒,双保险确保不立即成交
    );
    line(`下单响应: ${JSON.stringify(resp)}`);
    const orderID = resp.orderID || resp.orderId || resp.id || resp.order?.id;
    if (orderID) {
      line(`✓ 已接受,orderID=${orderID}。立即撤销…`);
      const cancel = await clob.cancelOrder({ orderID });
      line(`撤单响应: ${JSON.stringify(cancel)}`);
      line('✅ 端到端通过:鉴权 + 签名 + 服务端接受 + 撤单都 OK。实盘交易可行。');
    } else {
      line('⚠ 未拿到 orderID,可能被拒。看上面响应里的 errorMsg。');
      line('   若是「min size / 余额不足」=> 鉴权其实已通过;若是「signer ... API KEY」=> 签名类型仍不符。');
    }
  } catch (e) {
    line(`✗ 下单流程报错: ${e.shortMessage || e.message}`);
  }
}

main().catch((e) => {
  console.error('未捕获错误:', e);
  process.exit(1);
});
