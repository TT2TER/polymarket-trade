import { ClobClient, Chain, SignatureTypeV2, type ApiKeyCreds } from '@polymarket/clob-client-v2';
import { Wallet } from 'ethers';

export const CLOB_HOST = 'https://clob.polymarket.com';
export const CHAIN_ID = Chain.POLYGON;
// POLY_PROXY=1:邮箱/Magic 登录的 Polymarket 代理钱包。V2 枚举:EOA=0, POLY_PROXY=1, POLY_GNOSIS_SAFE=2, POLY_1271=3。
export const SIGNATURE_TYPE = SignatureTypeV2.POLY_PROXY;

export function buildSigner(privateKey: string): Wallet {
  // clob-client-v2 的签名者结构上接受 ethers v5 Wallet(具备 _signTypedData + getAddress)。
  return new Wallet(privateKey);
}

// 派生签名者(Magic EOA)地址。注意:对邮箱/代理钱包用户,该地址 ≠ funder(代理钱包地址),
// 故不能用它与 funder 做相等校验,只用于向用户显示核对。
export function deriveAddress(privateKey: string): string {
  return new Wallet(privateKey).address;
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
