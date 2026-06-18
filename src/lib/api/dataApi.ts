import type { Position } from '@/lib/types';

const POSITIONS_URL = 'https://data-api.polymarket.com/positions';

export async function getPositions(address: string): Promise<Position[]> {
  const url = new URL(POSITIONS_URL);
  url.searchParams.set('user', address);

  const response = await fetch(url.toString());
  // data-api 对「格式合法但无任何持仓记录」的地址返回 404(空钱包,或把 Signer/EOA 误填成代理钱包)。
  // 这不是错误,按「无持仓」处理,让 UI 显示空状态而非报错横幅。
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Positions request failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Positions response was not an array');
  }

  return data as Position[];
}
