import { useTranslation } from 'react-i18next';
import type { PriceBreakdown } from '../../lib/quotation-types';

interface Props {
  breakdown: PriceBreakdown;
}

export default function PriceSummary({ breakdown }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'es' | 'en';

  const formatPrice = (n: number) =>
    new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="price-summary">
      <div className="price-summary-label">{t('common.estimated_total')}</div>
      <div className="price-summary-amount">{formatPrice(breakdown.estimatedTotal)}</div>
      {breakdown.perGuestItems.length > 0 && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
          {lang === 'es' ? 'Incluye estimado por invitado' : 'Includes per-guest estimate'}
        </div>
      )}
    </div>
  );
}
