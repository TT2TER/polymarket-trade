// #1 价格走势 sparkline:把一段价格序列画成迷你折线,叠一条均价(成本)参考虚线。
// 纯展示组件,无 store 依赖;数据来自 store.priceHistory(见 lib/calc/priceHistory.ts)。
// 纵轴范围包含均价,使「现价在成本上方还是下方」一眼可读;着色随 gain/loss(深浅主题 + cn/us 自动翻转)。
// 宽度自适应:SVG 用固定坐标系 viewBox + preserveAspectRatio=none,CSS width:100% 随面板宽度横向拉伸
// (non-scaling-stroke 保证线宽不被拉粗)。

// viewBox 坐标系(与渲染像素无关,仅决定点的相对位置);横向会被 CSS 拉到容器实际宽度。
const VIEW_W = 100;
const VIEW_H = 20;
const PAD_Y = 1.5; // 顶部/底部留白,避免线贴边被裁。

interface SparklineProps {
  points: number[];
  /** 均价(成本):画成参考虚线。 */
  avgPrice: number;
  /** 盈亏方向决定折线颜色(与行内 pnl 一致)。 */
  gain: boolean;
}

export function Sparkline({ points, avgPrice, gain }: SparklineProps) {
  const series = points.filter((p) => Number.isFinite(p));
  if (series.length < 2) {
    return <span className="pq-spark pq-spark--empty" aria-hidden="true" />;
  }

  const includeAvg = Number.isFinite(avgPrice) && avgPrice > 0;
  const lo = Math.min(...series, includeAvg ? avgPrice : Infinity);
  const hi = Math.max(...series, includeAvg ? avgPrice : -Infinity);
  const span = hi - lo || 1; // 全平时给个非零跨度,折线落在中线。

  const usableH = VIEW_H - PAD_Y * 2;
  const yOf = (v: number): number => PAD_Y + (1 - (v - lo) / span) * usableH;
  const xOf = (i: number): number => (i / (series.length - 1)) * VIEW_W;

  const path = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(2)},${yOf(v).toFixed(2)}`).join(' ');
  const cls = gain ? 'pq-spark__line--up' : 'pq-spark__line--down';
  const avgY = includeAvg ? yOf(avgPrice) : null;

  return (
    <svg
      className="pq-spark"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {avgY !== null ? (
        <line className="pq-spark__avg" x1={0} y1={avgY} x2={VIEW_W} y2={avgY} strokeDasharray="2 2" />
      ) : null}
      <path className={`pq-spark__line ${cls}`} d={path} fill="none" />
    </svg>
  );
}
