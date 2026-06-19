import { ClobClient, Chain, SignatureTypeV2, type ApiKeyCreds } from '@polymarket/clob-client-v2';
import { createWalletClient, http, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

export const CLOB_HOST = 'https://clob.polymarket.com';
export const CHAIN_ID = Chain.POLYGON;
// 签名读写都走本地;此 RPC 仅作 viem walletClient 的占位 transport(签名不发网络请求)。
const RPC_URL = 'https://polygon-bor-rpc.publicnode.com';
// V2 枚举:EOA=0, POLY_PROXY=1, POLY_GNOSIS_SAFE=2, POLY_1271=3。
// 本账户经 scripts/test-deposit-wallet.mjs 诊断确认为「邮箱/Magic deposit wallet」(ERC-1271 代理):
// 只有 POLY_1271(3)+funder=deposit wallet 时 getBalanceAllowance 才返回真实余额;用 1/2 静默返回 0。
// (官方文档 trading/deposit-wallets + ts-sdk#73 印证;API key 绑 EOA 属设计如此,无需改。)
export const SIGNATURE_TYPE = SignatureTypeV2.POLY_1271;

// viem privateKeyToAccount 要求小写 0x 前缀的十六进制;兜底:去首尾空白 + 去任意大小写 0x/0X 前缀后统一补 0x。
function normalizePrivateKey(privateKey: string): `0x${string}` {
  const k = privateKey.trim().replace(/^0x/i, '');
  return `0x${k}` as `0x${string}`;
}

export function buildSigner(privateKey: string): WalletClient {
  // clob-client-v2 的 ClobSigner = EthersSigner | viem WalletClient。
  // 采用 viem walletClient —— 与官方文档及已实盘验证(挂单+撤单成功)的路径完全一致。
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  return createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
}

// 派生签名者(Magic EOA)地址。注意:对邮箱/代理钱包用户,该地址 ≠ funder(代理钱包地址),
// 故不能用它与 funder 做相等校验,只用于向用户显示核对。
export function deriveAddress(privateKey: string): string {
  return privateKeyToAccount(normalizePrivateKey(privateKey)).address;
}

export async function deriveCreds(privateKey: string): Promise<ApiKeyCreds> {
  return new ClobClient({ host: CLOB_HOST, chain: CHAIN_ID, signer: buildSigner(privateKey) }).createOrDeriveApiKey();
}

export function getAuthedClient(privateKey: string, creds: ApiKeyCreds, funder: string): ClobClient {
  return new ClobClient({
    host: CLOB_HOST,
    chain: CHAIN_ID,
    signer: buildSigner(privateKey),
    creds,
    signatureType: SIGNATURE_TYPE,
    funderAddress: funder,
  });
}
