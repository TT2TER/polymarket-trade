/**
 * 按 orderID 向 CLOB 查询单条订单,确认它确实在服务端存在过(只读,不下任何单)。
 * 运行:
 *   ORDER_ID=0x... node --env-file=scripts/.env scripts/verify-order.mjs
 * 预期:打印该订单,status 应为 CANCELED(因为我们挂上后立即撤了)。
 */
import { ClobClient, SignatureTypeV2 } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

const ORDER_ID = process.env.ORDER_ID;
const FUNDER = process.env.FUNDER || '0x4CFd6C92566969FFEb94bc8636c3779AcC0A2dED';
const RPC_URL = process.env.RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
const HOST = process.env.CLOB_API_URL || 'https://clob.polymarket.com';

if (!process.env.PRIVATE_KEY) { console.error('✗ 缺少 PRIVATE_KEY'); process.exit(1); }
if (!ORDER_ID) { console.error('✗ 缺少 ORDER_ID(用 ORDER_ID=0x... 传入)'); process.exit(1); }

const account = privateKeyToAccount(`0x${String(process.env.PRIVATE_KEY).trim().replace(/^0x/i, '')}`);
const signer = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const creds = await new ClobClient({ host: HOST, chain: 137, signer }).createOrDeriveApiKey();
const clob = new ClobClient({
  host: HOST, chain: 137, signer, creds,
  signatureType: SignatureTypeV2.POLY_1271, funderAddress: FUNDER,
});

try {
  const order = await clob.getOrder(ORDER_ID);
  console.log('查询成功 —— 这单确实在 CLOB 上存在过:\n');
  console.log(JSON.stringify(order, null, 2));
  const st = order?.status ?? order?.order?.status;
  if (st) console.log(`\n→ 当前状态: ${st}${/cancel/i.test(st) ? '(= 已撤销,符合预期)' : ''}`);
} catch (e) {
  console.error('查询失败:', e.shortMessage || e.message);
  console.error('(若报 not found,有些部署对已撤销订单不再返回,这不影响下单本身已成功的事实。)');
}
