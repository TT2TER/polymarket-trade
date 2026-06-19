import { useMemo } from 'react';
import { computeExposure, foldExposure } from '@/lib/calc/exposure';
import type { Position } from '@/lib/types';
import { useT } from '@/sidepanel/store';
import './ExposureBar.css';

interface ExposureBarProps {
  positions: Position[];
}

const MAX_ROWS = 6;
const CONCENTRATION_THRESHOLD = 0.4; // 单一 event 占比 ≥ 40% 视为过度集中,高亮。

// #5 风险敞口总览:按 event 聚合持仓价值占比,提示过度集中。仅 ≥2 个 event 时展示(单 event 无信息量)。
export function ExposureBar({ positions }: ExposureBarProps) {
  const t = useT();
  const rows = useMemo(() => {
    const summary = computeExposure(positions);
    return foldExposure(summary, MAX_ROWS, t('exposure.other'));
  }, [positions, t]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="pq-expo">
      <span className="pq-expo__title">{t('exposure.title')}</span>
      <div className="pq-expo__rows">
        {rows.map((row) => {
          const concentrated = row.share >= CONCENTRATION_THRESHOLD && !row.isOther;
          return (
            <div className="pq-expo__row" key={row.eventId} title={concentrated ? t('exposure.concentrated') : row.label}>
              <span className="pq-expo__label">{row.label}</span>
              <span className="pq-expo__track">
                <span
                  className={`pq-expo__fill ${concentrated ? 'pq-expo__fill--hot' : ''}`}
                  style={{ width: `${Math.min(100, row.share * 100)}%` }}
                />
              </span>
              <span className={`pq-expo__pct ${concentrated ? 'pq-expo__pct--hot' : ''}`}>
                {Math.round(row.share * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
