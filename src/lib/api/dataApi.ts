import type { Position } from '@/lib/types';

const POSITIONS_URL = 'https://data-api.polymarket.com/positions';

export async function getPositions(address: string): Promise<Position[]> {
  const url = new URL(POSITIONS_URL);
  url.searchParams.set('user', address);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Positions request failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Positions response was not an array');
  }

  return data as Position[];
}
