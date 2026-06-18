import type { Position } from '@/lib/types';
import { useT } from '@/sidepanel/store';
import './EquitySummary.css';

interface EquitySummaryProps {
  positions: Position[];
  todayPnl: number | null;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function money(value: number): string {
  return `$${finite(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function signedMoney(value: number): string {
  const v = finite(value);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// 红涨绿跌:盈→红(up),亏→绿(down)。
function sideClass(value: number): string {
  return value > 0 ? 'pq-sum__num--up' : value < 0 ? 'pq-sum__num--down' : '';
}

export function EquitySummary({ positions, todayPnl }: EquitySummaryProps) {
  const t = useT();
  // 仅统计未结算(持有中)持仓。
  const open = positions.filter((p) => !p.redeemable);
  const totalValue = open.reduce((sum, p) => sum + finite(p.currentValue), 0);
  const unrealized = open.reduce((sum, p) => sum + finite(p.cashPnl), 0);

  return (
    <div className="pq-sum">
      <div className="pq-sum__cell">
        <span className="pq-sum__label">{t('summary.totalValue')}</span>
        <strong className="pq-sum__num">{money(totalValue)}</strong>
      </div>
      <div className="pq-sum__cell">
        <span className="pq-sum__label">{t('summary.today')}</span>
        <strong className={`pq-sum__num ${todayPnl === null ? '' : sideClass(todayPnl)}`}>
          {todayPnl === null ? '—' : signedMoney(todayPnl)}
        </strong>
      </div>
      <div className="pq-sum__cell">
        <span className="pq-sum__label">{t('summary.unrealized')}</span>
        <strong className={`pq-sum__num ${sideClass(unrealized)}`}>{signedMoney(unrealized)}</strong>
      </div>
    </div>
  );
}
