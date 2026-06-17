import type { I18nKey } from '@/shared/i18n';
import { useT } from '@/sidepanel/store';

export interface ConfirmOrderDetails {
  title: string;
  modeLabelKey: I18nKey;
  price: number;
  size: number;
  estAmount: number;
  orderType: string;
  dryRun: boolean;
  postOnly: boolean;
  warning?: string;
  remaining?: number;
}

interface ConfirmDialogProps {
  details: ConfirmOrderDetails | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function ConfirmDialog({ details, isSubmitting, onCancel, onConfirm }: ConfirmDialogProps) {
  const t = useT();

  if (!details) {
    return null;
  }

  return (
    <div className="confirm-dialog" role="presentation">
      <div aria-labelledby="confirm-order-title" aria-modal="true" className="confirm-dialog__panel" role="dialog">
        <header className="confirm-dialog__header">
          <h3 id="confirm-order-title">{t('confirm.title')}</h3>
          {details.dryRun ? <span className="dry-run-pill">{t('order.dryRun')}</span> : null}
        </header>

        <div className="confirm-dialog__body">
          <div>
            <span>{t('confirm.position')}</span>
            <strong>{details.title}</strong>
          </div>
          <div>
            <span>{t('confirm.mode')}</span>
            <strong>{t(details.modeLabelKey)}</strong>
          </div>
          <div>
            <span>{t('confirm.direction')}</span>
            <strong>{t('confirm.sell')}</strong>
          </div>
          <div>
            <span>{t('confirm.price')}</span>
            <strong>{details.price.toFixed(4)}</strong>
          </div>
          <div>
            <span>{t('confirm.size')}</span>
            <strong>{formatNumber(details.size)}</strong>
          </div>
          <div>
            <span>{t('confirm.estimatedAmount')}</span>
            <strong>{formatCurrency(details.estAmount)}</strong>
          </div>
          <div>
            <span>{t('confirm.orderType')}</span>
            <strong>
              {details.orderType}
              {details.postOnly ? ` ${t('confirm.postOnly')}` : ''}
            </strong>
          </div>
          {typeof details.remaining === 'number' ? (
            <div>
              <span>{t('confirm.remaining')}</span>
              <strong>{formatNumber(details.remaining)}</strong>
            </div>
          ) : null}
        </div>

        {details.warning ? <p className="confirm-dialog__warning">{details.warning}</p> : null}
        {details.dryRun ? <p className="confirm-dialog__notice">{t('confirm.dryRunNotice')}</p> : null}

        <footer className="confirm-dialog__actions">
          <button disabled={isSubmitting} onClick={onCancel} type="button">
            {t('confirm.cancel')}
          </button>
          <button className="confirm-dialog__confirm" disabled={isSubmitting} onClick={onConfirm} type="button">
            {isSubmitting ? t('confirm.placing') : t('confirm.confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}
