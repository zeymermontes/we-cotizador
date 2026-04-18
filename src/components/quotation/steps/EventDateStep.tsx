import { useTranslation } from 'react-i18next';
import type { QuotationFormData } from '../../../lib/quotation-types';

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
}

export default function EventDateStep({ formData, updateField }: Props) {
  const { t } = useTranslation();

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{t('step4.title')}</h2>
        <p className="step-subtitle">{t('step4.subtitle')}</p>
      </div>

      <div className="input-group">
        <label className="input-label">{t('step4.date_label')} *</label>
        <input
          className="input-field"
          type="date"
          value={formData.eventDate}
          onChange={(e) => updateField('eventDate', e.target.value)}
          min={new Date().toISOString().split('T')[0]}
          style={{ colorScheme: 'dark' }}
        />
      </div>
    </div>
  );
}
