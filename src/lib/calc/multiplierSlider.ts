/*
 * 非线性「目标倍数 N」滑块映射(详见设计 README):
 *   前 60% 轨道线性映射 1→3×,后 40% 对数映射 3→20×。
 *   posFromN(N) = N<=3 ? (N-1)/2*60 : 60 + ln(N/3)/ln(NMAX/3)*40
 *   nFromPos(p) = p<=60 ? 1 + p/60*2 : 3*(NMAX/3)^((p-60)/40)
 * N 四舍五入到 0.1。
 */

export const N_MIN = 1;
export const N_MAX = 20;
const SPLIT_POS = 60; // 轨道上 3× 的位置(%)

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** 倍数 N → 滑块位置(0..100) */
export function posFromN(n: number): number {
  const safe = clamp(Number.isFinite(n) ? n : N_MIN, N_MIN, N_MAX);
  const pos = safe <= 3 ? ((safe - 1) / 2) * SPLIT_POS : SPLIT_POS + (Math.log(safe / 3) / Math.log(N_MAX / 3)) * (100 - SPLIT_POS);
  return clamp(pos, 0, 100);
}

/** 滑块位置(0..100) → 倍数 N(四舍五入到 0.1) */
export function nFromPos(pos: number): number {
  const p = clamp(Number.isFinite(pos) ? pos : 0, 0, 100);
  const raw = p <= SPLIT_POS ? 1 + (p / SPLIT_POS) * 2 : 3 * Math.pow(N_MAX / 3, (p - SPLIT_POS) / (100 - SPLIT_POS));
  return clamp(Math.round(raw * 10) / 10, N_MIN, N_MAX);
}

/** 刻度倍数 → 其在轨道上的位置(%),用于绘制刻度标记 */
export const N_TICKS = [1, 2, 3, 5, 10, 20] as const;
