import { useState } from 'react';
import type { PositionView } from '@/lib/types';
import { useT } from '@/sidepanel/store';
import { AlertPanel } from './AlertPanel';
import { ConditionalPanel } from './ConditionalPanel';
import { OpenOrders } from './OpenOrders';
import { OrderActions } from './OrderActions';
import { OrderBookView } from './OrderBookView';
import { StopLossPanel } from './StopLossPanel';
import './PositionOps.css';

interface PositionOpsProps {
  view: PositionView;
  multipliers: number[];
}

type OpsTab = 'trade' | 'stop' | 'alert' | 'cond';

function formatCents(price: number): string {
  const c = (Number.isFinite(price) ? price : 0) * 100;
  if (c > 0 && c < 9.5) {
    return `${c.toFixed(1)}¢`;
  }
  return `${Math.round(c)}¢`;
}

function formatN(value: number): string {
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

// 展开操作区:回本翻倍价 chips + 盘口 + 挂单 + 交易/止损 Tab。
// Tab 用数组方便未来扩展(如「走势/预测」)。
export function PositionOps({ view, multipliers }: PositionOpsProps) {
  const t = useT();
  const [tab, setTab] = useState<OpsTab>('trade');

  const tabs: { id: OpsTab; label: string }[] = [
    { id: 'trade', label: t('order.trade') },
    { id: 'stop', label: t('stopLoss.title') },
    { id: 'alert', label: t('alert.tab') },
    { id: 'cond', label: t('cond.tab') },
  ];

  return (
    <div className="pq-ops">
      <div className="pq-chips">
        <span className="pq-chips__label">{t('ops.targetPrices')}</span>
        <div className="pq-chips__row">
          {view.targetPrices.map((target, index) => (
            <span
              className={`pq-chip ${target.reachable ? '' : 'pq-chip--capped'}`}
              key={`${target.multiple}-${index}`}
            >
              {target.multiple}× {formatCents(target.price)}
              {!target.reachable ? ` ${t('ops.capped')}` : ''}
            </span>
          ))}
          {/* 封盘倍率:市场结算到 $1 时相对均价的盈利倍数 = 1/均价 */}
          {view.position.avgPrice > 0 ? (
            <span className="pq-chip pq-chip--settle">
              {t('ops.settleMultiple', { n: formatN(Math.round((1 / view.position.avgPrice) * 10) / 10) })}
            </span>
          ) : null}
        </div>
      </div>

      <OrderBookView book={view.book} />
      <OpenOrders asset={view.position.asset} />

      <hr className="pq-divider" />

      <div className="pq-tabs">
        {tabs.map((item) => (
          <button
            className={`pq-tab ${tab === item.id ? 'pq-tab--active' : ''}`}
            key={item.id}
            onClick={() => setTab(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'trade' ? (
        <OrderActions book={view.book} multipliers={multipliers} position={view.position} />
      ) : tab === 'stop' ? (
        <StopLossPanel bestBid={view.bestBid} position={view.position} />
      ) : tab === 'alert' ? (
        <AlertPanel position={view.position} />
      ) : (
        <ConditionalPanel position={view.position} />
      )}
    </div>
  );
}
