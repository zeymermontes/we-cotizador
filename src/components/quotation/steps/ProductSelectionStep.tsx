import { useTranslation } from 'react-i18next';
import type { QuotationFormData, ProductType } from '../../../lib/quotation-types';

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
}

const PRODUCTS: { value: ProductType; key: string }[] = [
  { value: 'invitacion_digital', key: 'invitacion_digital' },
  { value: 'save_the_date', key: 'save_the_date' },
  { value: 'envio_invitaciones', key: 'envio_invitaciones' },
  { value: 'confirmaciones', key: 'confirmaciones' },
];

export default function ProductSelectionStep({ formData, updateField }: Props) {
  const { t } = useTranslation();

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{t('step5.title')}</h2>
        <p className="step-subtitle">{t('step5.subtitle')}</p>
      </div>

      {PRODUCTS.map(prod => (
        <div
          key={prod.value}
          className={`option-card ${formData.productType === prod.value ? 'selected' : ''}`}
          onClick={() => updateField('productType', prod.value)}
        >
          <div className="option-radio" />
          <div className="option-content">
            <div className="option-title">{t(`step5.${prod.key}`)}</div>
            <div className="option-desc">{t(`step5.${prod.key}_desc`)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
