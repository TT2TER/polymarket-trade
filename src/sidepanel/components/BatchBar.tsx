import { useRef, useState } from 'react';
import { getBestAsk, getBestBid } from '@/lib/api/clobApi';
import type { OrderBook, Position } from '@/lib/types';
import type { PrepareOrderRequest } from '@/shared/messages';
import { useMonitorStore, useT } from '@/sidepanel/store';
import './BatchBar.css';

interface BatchBarProps {
  positions: Position[];
  books: Record<string, OrderBook>;
}

type BatchKind = 'closeLosing' | 'tpWinning';

interface PreparedLeg {
  tokenID: string;
  title: string;
  qty?: number;
  price?: number;
  est?: number;
  nonce?: string;
  // 固化 prepare 时的 dryRun(而非读当前 config.dryRun),避免准备→确认间切换开关导致显示与实际不符。
  dryRun?: boolean;
  error?: string;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function livePrice(position: Position, book: OrderBook | null): number {
  const bid = getBestBid(book);
  return bid > 0 ? bid : finite(position.curPrice);
}

function formatShares(value: number): string {
  return finite(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoney(value: number): string {
  return `$${finite(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatCents(price: number): string {
  return `${Math.round(finite(price) * 100)}¢`;
}

// #7 批量/组合操作:把单仓卖出升维到组合层。复用已审的单笔 prepare→confirm 路径(每腿仍受 H1/H2/maxOrderUsd 护栏),
// 额外加一层批量总额上限 batchMaxUsd。逐腿确认弹窗列出每仓方向/量/合计。
export function BatchBar({ positions, books }: BatchBarProps) {
  const t = useT();
  const config = useMonitorStore((state) => state.config);
  const authStatus = useMonitorStore((state) => state.authStatus);
  const prepareOrder = useMonitorStore((state) => state.prepareOrder);
  const confirmOrder = useMonitorStore((state) => state.confirmOrder);

  const [n, setN] = useState(2);
  const [kind, setKind] = useState<BatchKind | null>(null);
  const [legs, setLegs] = useState<PreparedLeg[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // 提交去抖:setBusy 是异步生效,用 ref 同步防快速双击导致的重复批量提交。
  const inFlight = useRef(false);

  if (!authStatus.authenticated) {
    return null; // 批量操作需已启用交易。
  }

  // 去重:按 asset 取首个(data-api 若返回重复行,避免同仓被 prepare+confirm 多次而重复卖出)。
  const open: Position[] = [];
  const seenAssets = new Set<string>();
  for (const position of positions) {
    if (position.redeemable || !(position.size > 0) || seenAssets.has(position.asset)) {
      continue;
    }
    seenAssets.add(position.asset);
    open.push(position);
  }

  // 计算某批量的候选腿(含 prepare 所需 payload)。
  function buildCandidates(target: BatchKind): { tokenID: string; title: string; payload: Omit<PrepareOrderRequest, 'type'> }[] {
    const out: { tokenID: string; title: string; payload: Omit<PrepareOrderRequest, 'type'> }[] = [];
    for (const position of open) {
      const book = books[position.asset] ?? null;
      const bestBid = getBestBid(book);
      const bestAsk = getBestAsk(book);
      const price = livePrice(position, book);
      const pnl = (price - finite(position.avgPrice)) * position.size;
      const base: Omit<PrepareOrderRequest, 'type'> = {
        tokenID: position.asset,
        mode: 'taker',
        negRisk: position.negativeRisk,
        avgPrice: position.avgPrice,
        positionSize: position.size,
        bestBid,
        bestAsk,
      };
      if (target === 'closeLosing') {
        if (pnl < 0 && bestBid > 0) {
          out.push({ tokenID: position.asset, title: `${position.title} · ${position.outcome}`, payload: { ...base, mode: 'taker', size: position.size } });
        }
      } else if (target === 'tpWinning') {
        // 止盈:仅盈利仓 + N×均价可达(≤$1)才挂 limitN 整仓卖。
        const reachable = position.avgPrice > 0 && n * position.avgPrice <= 1;
        if (pnl > 0 && reachable) {
          out.push({ tokenID: position.asset, title: `${position.title} · ${position.outcome}`, payload: { ...base, mode: 'limitN', n, size: position.size } });
        }
      }
    }
    return out;
  }

  async function startSellBatch(target: BatchKind): Promise<void> {
    setResult(null);
    setNote(null);
    const candidates = buildCandidates(target);
    if (candidates.length === 0) {
      setNote(t('batch.noTargets'));
      return;
    }
    setBusy(true);
    const prepared: PreparedLeg[] = [];
    for (const candidate of candidates) {
      try {
        const { nonce, preview } = await prepareOrder(candidate.payload);
        prepared.push({ tokenID: candidate.tokenID, title: candidate.title, qty: preview.size, price: preview.price, est: preview.estAmount, nonce, dryRun: preview.dryRun });
      } catch (error) {
        prepared.push({ tokenID: candidate.tokenID, title: candidate.title, error: error instanceof Error ? error.message : String(error) });
      }
    }
    setBusy(false);
    setLegs(prepared);
    setKind(target);
  }

  const executableLegs = legs.filter((leg) => !leg.error && leg.nonce);
  const totalEst = executableLegs.reduce((sum, leg) => sum + finite(leg.est ?? 0), 0);
  const capExceeded = totalEst > config.batchMaxUsd;

  async function confirmBatch(): Promise<void> {
    if (inFlight.current) {
      return; // 同步去抖,防快速双击重复提交。
    }
    // 卖出批量:确认时再次校验批量总额上限(不只依赖按钮 disabled,防 stale closure 绕过)。
    if (totalEst > config.batchMaxUsd) {
      setResult(t('batch.capExceeded'));
      setKind(null);
      setLegs([]);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const leg of legs) {
      if (leg.error || !leg.nonce) {
        fail += 1;
        continue;
      }
      try {
        await confirmOrder(leg.nonce, leg.tokenID);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    inFlight.current = false;
    setBusy(false);
    setKind(null);
    setLegs([]);
    setResult(t('batch.result', { ok, fail }));
  }

  function closeModal(): void {
    setKind(null);
    setLegs([]);
  }

  return (
    <div className="pq-batch">
      <div className="pq-batch__head">
        <span className="pq-batch__title">{t('batch.title')}</span>
        <label className="pq-batch__n">
          <span>{t('batch.n')}</span>
          <input
            max={20}
            min={1}
            onChange={(e) => setN(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            step={0.5}
            type="number"
            value={n}
          />
        </label>
      </div>
      <div className="pq-batch__actions">
        <button className="pq-batch__btn pq-batch__btn--sell" disabled={busy} onClick={() => void startSellBatch('closeLosing')} type="button">
          {t('batch.closeLosing')}
        </button>
        <button className="pq-batch__btn" disabled={busy} onClick={() => void startSellBatch('tpWinning')} type="button">
          {t('batch.tpWinning', { n })}
        </button>
      </div>
      {note ? <p className="pq-batch__note">{note}</p> : null}
      {result ? <p className="pq-batch__result">{result}</p> : null}

      {kind ? (
        <div aria-modal="true" className="pq-batch__overlay" role="dialog">
          <div className="pq-batch__modal">
            <h3 className="pq-batch__modalTitle">{t('batch.confirmTitle')}</h3>

            <ul className="pq-batch__legs">
              {legs.map((leg) => (
                <li className="pq-batch__leg" key={leg.tokenID}>
                  <span className="pq-batch__legTitle">{leg.title}</span>
                  {leg.error ? (
                    <span className="pq-batch__legErr">{t('batch.legError', { error: leg.error })}</span>
                  ) : (
                    <span className="pq-batch__legBody">
                      {t('batch.legSell', { qty: formatShares(leg.qty ?? 0), price: formatCents(leg.price ?? 0) })}
                      <span className="pq-batch__legEst"> · {formatMoney(leg.est ?? 0)}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="pq-batch__totals">
              <span>
                {t('batch.total')}: <strong>{formatMoney(totalEst)}</strong>
              </span>
              <span className={capExceeded ? 'pq-batch__cap--bad' : 'pq-batch__cap'}>
                {t('batch.cap')}: {formatMoney(config.batchMaxUsd)}
              </span>
            </div>
            {capExceeded ? <p className="pq-batch__capWarn">{t('batch.capExceeded')}</p> : null}
            {/* dryRun 提示按「已准备各腿固化的 dryRun」判定,而非当前 config(防准备→确认间切换造成误示)。 */}
            {executableLegs.some((leg) => leg.dryRun) ? <p className="pq-batch__note">{t('batch.dryRunNote')}</p> : null}

            <div className="pq-batch__modalActions">
              <button className="pq-batch__btn" disabled={busy} onClick={closeModal} type="button">
                {t('batch.cancel')}
              </button>
              <button
                className="pq-batch__btn pq-batch__btn--go"
                disabled={busy || capExceeded || executableLegs.length === 0}
                onClick={() => void confirmBatch()}
                type="button"
              >
                {busy ? t('batch.running') : t('batch.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
