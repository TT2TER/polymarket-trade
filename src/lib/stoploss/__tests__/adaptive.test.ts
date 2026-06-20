import { describe, expect, it } from 'vitest';
import { createStopLossDetectorState, evaluate } from '@/lib/stoploss/detector';
import { DEFAULT_STOP_LOSS_DEFAULTS, type ResolvedStopLossConfig } from '@/shared/stopLossConfig';

// refK=1:旁路中位数平滑,直接用喂入价控制 ref,便于注入波动/控制破位深度。
function cfg(overrides: Partial<ResolvedStopLossConfig> = {}): ResolvedStopLossConfig {
  return { ...DEFAULT_STOP_LOSS_DEFAULTS, armed: true, refK: 1, dwellMs: 1_000, ...overrides };
}

describe('stoploss detector — Phase 2a 自适应', () => {
  it('波动自适应:高环境波动给出比平静更宽的阈值(同价位比较)', () => {
    const calm = createStopLossDetectorState();
    const choppy = createStopLossDetectorState();
    const config = cfg({ anchor: 'peak', baseThreshold: 0.05 });

    // 平静:连续平价;震荡:0.50↔0.70 大幅来回。各喂 16 拍(每拍 1s),抬高 choppy 的 σ_ambient。
    let t = 1_000;
    for (let i = 0; i < 16; i += 1) {
      evaluate(calm, 0.6, t, { cost: 0.2, config });
      evaluate(choppy, i % 2 === 0 ? 0.5 : 0.7, t, { cost: 0.2, config });
      t += 1_000;
    }
    // 末拍都落到同一价位 0.60,比较同价位下的阈值 → 隔离出 volFactor 的作用。
    const calmRes = evaluate(calm, 0.6, t, { cost: 0.2, config });
    const choppyRes = evaluate(choppy, 0.6, t, { cost: 0.2, config });

    expect(calmRes.ref).toBeCloseTo(0.6, 6);
    expect(choppyRes.ref).toBeCloseTo(0.6, 6);
    expect(choppyRes.threshold).toBeGreaterThan(calmRes.threshold * 1.3);
  });

  it('速度自适应 dwell:破得越深,确认越快', () => {
    const deep = createStopLossDetectorState();
    const shallow = createStopLossDetectorState();
    const config = cfg({ anchor: 'cost', maxLossPct: 0.25 }); // exitLine = 0.5*(1-0.25) = 0.375

    // 首拍进入破位。
    evaluate(deep, 0.3, 1_000, { cost: 0.5, config }); // depth≈0.20 → severity 1 → dwell≈600
    evaluate(shallow, 0.37, 1_000, { cost: 0.5, config }); // depth≈0.013 → dwell≈887

    // elapsed 700ms:深破已确认,浅破尚未。
    const d = evaluate(deep, 0.3, 1_700, { cost: 0.5, config });
    const s = evaluate(shallow, 0.37, 1_700, { cost: 0.5, config });
    expect(d.breach).toBe(true);
    expect(s.breach).toBe(true);
    expect(d.dwellMs).toBeLessThan(s.dwellMs); // 深破生效 dwell 更短
    expect(d.triggered).toBe(true);
    expect(s.triggered).toBe(false);

    // 浅破持续更久后才触发。
    const s2 = evaluate(shallow, 0.37, 1_950, { cost: 0.5, config });
    expect(s2.triggered).toBe(true);
  });

  it('边界:dwellMs=0 立即确认', () => {
    const state = createStopLossDetectorState();
    const config = cfg({ anchor: 'cost', maxLossPct: 0.25, dwellMs: 0 }); // exitLine = 0.375
    const r = evaluate(state, 0.3, 1_000, { cost: 0.5, config });
    expect(r.breach).toBe(true);
    expect(r.dwellMs).toBe(0);
    expect(r.triggered).toBe(true);
  });

  it('边界:dwellMs < MIN_DWELL 不被钳高', () => {
    const state = createStopLossDetectorState();
    const config = cfg({ anchor: 'cost', maxLossPct: 0.25, dwellMs: 500 });
    evaluate(state, 0.3, 1_000, { cost: 0.5, config }); // 深破,breachStart=1000
    const r = evaluate(state, 0.3, 1_500, { cost: 0.5, config }); // elapsed 500
    expect(r.dwellMs).toBe(500); // 配置 < 600,不被抬到下限
    expect(r.triggered).toBe(true);
  });

  it('边界:触发后持续破位不重复触发(冷却)', () => {
    const state = createStopLossDetectorState();
    const config = cfg({ anchor: 'cost', maxLossPct: 0.25, dwellMs: 0 });
    expect(evaluate(state, 0.3, 1_000, { cost: 0.5, config }).triggered).toBe(true);
    const r2 = evaluate(state, 0.3, 1_100, { cost: 0.5, config });
    expect(r2.breach).toBe(true);
    expect(r2.triggered).toBe(false); // 冷却期内不重复
    expect(evaluate(state, 0.3, 2_000, { cost: 0.5, config }).triggered).toBe(false);
  });

  it('波动顺序(SEVERE 守护):平静后单根大跌仍按当拍阈值判定,不被自身瞬时位移撑宽而漏判', () => {
    const state = createStopLossDetectorState();
    const config = cfg({ anchor: 'peak', baseThreshold: 0.05, dwellMs: 0 });
    // 平静:在 0.70 附近多拍,建立低环境波动 + peak=0.70。
    for (let i = 0; i < 10; i += 1) {
      evaluate(state, 0.7, 1_000 + i * 1_000, { cost: 0.2, config });
    }
    // 长间隔后单根大跌到 0.62:用上一拍(平静)阈值应破线;若本拍位移先污染 EWMA 把阈值撑到上限则会漏判。
    const drop = evaluate(state, 0.62, 200_000, { cost: 0.2, config });
    expect(drop.breach).toBe(true);
  });
});
