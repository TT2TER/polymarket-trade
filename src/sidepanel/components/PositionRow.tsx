import { useEffect, useRef } from 'react';
import { progressBar } from '@/lib/calc/progressBar';
import { marketTimer } from '@/lib/calc/settlementCountdown';
import type { PositionView } from '@/lib/types';
import { useMonitorStore, useT } from '@/sidepanel/store';
import { Sparkline } from './Sparkline';
import './Sparkline.css';

// 稳定空数组:无价格历史的仓位复用同一引用,避免选择器每帧返回新空数组触发重渲染。
const EMPTY_POINTS: number[] = [];

interface PositionRowProps {
  view: PositionView;
  /** 默认目标倍数(config.multipliers[0]);每仓实际 N 优先取 store 覆盖值,与交易 Tab 滑块联动 */
  defaultMultiplier: number;
  isOpen: boolean;
  onToggle: () => void;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatCents(price: number): string {
  const c = finite(price) * 100;
  if (c > 0 && c < 9.5) {
    return `${c.toFixed(1)}¢`;
  }
  return `${Math.round(c)}¢`;
}

function formatShares(value: number): string {
  return finite(value).toLocaleString(undefined, { maximumFractionDigits: value > 1000 ? 0 : 2 });
}

function formatPercent(value: number): string {
  const v = finite(value);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const abs = Math.abs(v);
  return `${sign}${abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)}%`;
}

function formatMoney(value: number): string {
  const v = finite(value);
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
}

export function PositionRow({ view, defaultMultiplier, isOpen, onToggle }: PositionRowProps) {
  const t = useT();
  const stopLossConfig = useMonitorStore((state) => state.stopLossConfigs[view.position.asset]);
  const storedMultiplier = useMonitorStore((state) => state.targetMultipliers[view.position.asset]);
  const points = useMonitorStore((state) => state.priceHistory[view.position.asset]) ?? EMPTY_POINTS;
  const targetMultiplier = storedMultiplier ?? defaultMultiplier;

  // #4 市场时间提示:体育单场=开赛倒计时(开赛后「进行中」),聚合市场=结算倒计时。
  // 元数据未拉到/太远(>30d)则不渲染 chip。
  const meta = useMonitorStore((state) => state.marketMeta[view.position.conditionId]);
  const timer = marketTimer(meta?.kickoff ?? null, meta?.settleTime ?? null);

  // 行内金额口径:左=持仓成本(avgPrice×份额),右=当前总价(现价×份额);涨跌色按未实现盈亏。
  // L1 百分比展示未实现收益率(+375%)。已实现盈亏不并入此处,需要看请去成交历史。
  const unrealized = view.unrealizedPnlAbsolute;
  const gain = unrealized >= 0;
  const cost = finite(view.position.avgPrice) * finite(view.position.size); // 持仓成本
  const totalValue = view.positionValue; // 当前总价 = 现价 × 份额(cost + unrealized)
  const side = gain ? 'up' : 'down';

  const bar = progressBar(view.position.avgPrice, view.currentPrice, targetMultiplier);
  const armed = stopLossConfig?.armed ?? false;

  // 现价跳动闪烁:用 ref 直接操作 DOM class,避免 setState 引入额外渲染。
  // 「移类 → 强制回流 → 加类」以在连续 tick(快于动画时长)时可靠地重启动画。
  const rowRef = useRef<HTMLButtonElement>(null);
  const prevPriceRef = useRef(view.currentPrice);
  useEffect(() => {
    const el = rowRef.current;
    const prev = prevPriceRef.current;
    prevPriceRef.current = view.currentPrice;
    if (!el || prev === view.currentPrice || !Number.isFinite(prev) || !Number.isFinite(view.currentPrice)) {
      return;
    }
    const cls = view.currentPrice > prev ? 'pq-row--flash-up' : 'pq-row--flash-down';
    el.classList.remove('pq-row--flash-up', 'pq-row--flash-down');
    void el.offsetWidth; // 强制回流,重启 CSS 动画
    el.classList.add(cls);
  }, [view.currentPrice]);

  return (
    <button
      aria-expanded={isOpen}
      className={`pq-row ${isOpen ? 'pq-row--open' : ''}`}
      onClick={onToggle}
      ref={rowRef}
      type="button"
    >
      <div className="pq-row__l1">
        <span className={`pq-tag pq-tag--${side}`}>{view.position.outcome.toUpperCase()}</span>
        <span className="pq-row__title">{view.position.title}</span>
        {timer && !timer.farFuture ? <TimerChip timer={timer} t={t} /> : null}
        <span className={`pq-row__pnl pq-row__pnl--${side}`}>{formatPercent(view.unrealizedPnlPercent)}</span>
        <span className={`pq-row__chev ${isOpen ? 'pq-row__chev--open' : ''}`}>▾</span>
      </div>

      <div className="pq-row__l2">
        <span className="pq-row__nums">
          <span className="pq-muted">{formatShares(view.position.size)}</span>
          <span className="pq-muted"> @ {formatCents(view.position.avgPrice)}</span>
          <span className="pq-arrow"> → </span>
          <span className="pq-strongnum">{formatCents(view.currentPrice)}</span>
        </span>
        <Sparkline avgPrice={view.position.avgPrice} gain={gain} points={points} />
        <span className="pq-row__value">
          {formatMoney(cost)}
          <span className="pq-dot"> · </span>
          <span className={`pq-row__pnl--${side}`}>{formatMoney(totalValue)}</span>
        </span>
      </div>

      {/* 进度条始终展示(不被止损武装覆盖) */}
      <div className="pq-row__l3">
        <ProgressTrack bar={bar} multiplier={targetMultiplier} cappedLabel={t('position.capped')} t={t} />
      </div>

      {/* 止损已武装:进度条下方追加一条提示,不再替换进度条 */}
      {armed ? (
        <div className="pq-row__l4">
          <span className="pq-armed">
            ⛨ {t('row.armed', {
              window: Math.round((stopLossConfig?.windowMs ?? 0) / 1000),
              threshold: ((stopLossConfig?.threshold ?? 0) * 100).toFixed(0),
              fraction: ((stopLossConfig?.sellFraction ?? 0) * 100).toFixed(0),
            })}
          </span>
        </div>
      ) : null}
    </button>
  );
}

// #4 时间 chip:开赛倒计时(⚽)/ 进行中 / 结算倒计时(⏱)/ 结算中。
function TimerChip({ timer, t }: { timer: ReturnType<typeof marketTimer>; t: ReturnType<typeof useT> }) {
  if (!timer) {
    return null;
  }
  if (timer.kind === 'live') {
    return <span className="pq-clock pq-clock--live">● {t('row.live')}</span>;
  }
  if (timer.kind === 'closed') {
    return <span className="pq-clock pq-clock--closed">{t('row.settling')}</span>;
  }
  const isKickoff = timer.kind === 'kickoff';
  const title = isKickoff ? t('row.kickoffIn', { label: timer.label }) : t('row.settleIn', { label: timer.label });
  return (
    <span className={`pq-clock pq-clock--${timer.urgency}`} title={title}>
      {isKickoff ? '⚽' : '⏱'}
      {timer.label}
    </span>
  );
}

function ProgressTrack({
  bar,
  multiplier,
  cappedLabel,
  t,
}: {
  bar: ReturnType<typeof progressBar>;
  multiplier: number;
  cappedLabel: string;
  t: ReturnType<typeof useT>;
}) {
  const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;
  const fillLeft = Math.min(bar.fillStart, bar.fillEnd);
  const fillWidth = Math.abs(bar.fillEnd - bar.fillStart);

  if (bar.mode === 'loss') {
    return (
      <div className="pq-bar">
        <div className="pq-bar__track">
          <span
            className="pq-bar__fill pq-bar__fill--down"
            style={{ left: pct(fillLeft), width: pct(fillWidth) }}
          />
          <span className="pq-bar__knob pq-bar__knob--down" style={{ left: pct(bar.currentPos) }} />
        </div>
        <div className="pq-bar__labels">
          <span className="pq-bar__label">{t('row.wipeout')} 0¢</span>
          <span className="pq-bar__label">{t('row.breakeven')} {formatCents(bar.entry)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pq-bar">
      <div className="pq-bar__track">
        <span
          className={`pq-bar__fill pq-bar__fill--${bar.fillSide}`}
          style={{ left: pct(fillLeft), width: pct(fillWidth) }}
        />
        {bar.targetPos !== undefined ? (
          <span className="pq-bar__target" style={{ left: pct(bar.targetPos) }} />
        ) : null}
        <span className={`pq-bar__knob pq-bar__knob--${bar.fillSide}`} style={{ left: pct(bar.currentPos) }} />
      </div>
      <div className="pq-bar__labels">
        <span className="pq-bar__label">IN {formatCents(bar.entry)}</span>
        <span className="pq-bar__label pq-bar__label--target">
          {multiplier % 1 === 0 ? multiplier : multiplier.toFixed(1)}× {formatCents(bar.target ?? 0)}
          {bar.reachable === false ? ` ${cappedLabel}` : ''}
        </span>
      </div>
    </div>
  );
}
