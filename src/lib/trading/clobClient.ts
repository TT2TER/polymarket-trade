import { ClobClient, type ApiKeyCreds } from '@polymarket/clob-client';
import { Wallet } from 'ethers';

export const CLOB_HOST = 'https://clob.polymarket.com';
export const CHAIN_ID = 137;
export const SIGNATURE_TYPE = 1;

export function buildSigner(privateKey: string): Wallet {
  // clob-client 5.8.1 accepts an ethers-style signer structurally
  // (_signTypedData + getAddress); ethers v5 Wallet provides that shape.
  return new Wallet(privateKey);
}

// 派生签名者(Magic EOA)地址。注意:对邮箱/代理钱包用户,该地址 ≠ funder(代理钱包地址),
// 故不能用它与 funder 做相等校验,只用于向用户显示核对。
export function deriveAddress(privateKey: string): string {
  return new Wallet(privateKey).address;
}

export async function deriveCreds(privateKey: string): Promise<ApiKeyCreds> {
  return new ClobClient(CLOB_HOST, CHAIN_ID, buildSigner(privateKey)).createOrDeriveApiKey();
}

export function getAuthedClient(privateKey: string, creds: ApiKeyCreds, funder: string): ClobClient {
  return new ClobClient(CLOB_HOST, CHAIN_ID, buildSigner(privateKey), creds, SIGNATURE_TYPE, funder);
}
