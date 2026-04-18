import { useTranslation } from 'react-i18next';
import type { QuotationFormData } from '../../../lib/quotation-types';

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
}

export default function ContactInfoStep({ formData, updateField }: Props) {
  const { t } = useTranslation();

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{t('step1.title')}</h2>
        <p className="step-subtitle">{t('step1.subtitle')}</p>
      </div>

      <div className="input-group">
        <label className="input-label">{t('step1.name')} *</label>
        <input
          className="input-field"
          type="text"
          value={formData.contactName}
          onChange={(e) => updateField('contactName', e.target.value)}
          placeholder={t('step1.name_placeholder')}
          autoFocus
        />
      </div>

      <div className="input-group">
        <label className="input-label">{t('step1.phone')} *</label>
        <input
          className="input-field"
          type="tel"
          value={formData.contactPhone}
          onChange={(e) => updateField('contactPhone', e.target.value)}
          placeholder={t('step1.phone_placeholder')}
        />
      </div>
    </div>
  );
}
