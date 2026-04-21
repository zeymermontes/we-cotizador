import { useTranslation } from 'react-i18next';
import type { QuotationFormData } from '../../../lib/quotation-types';
import { PhoneInput } from 'react-international-phone';
import 'react-international-phone/style.css';

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
  goNext: () => void;
  canGoNext: boolean;
}

export default function ContactInfoStep({ formData, updateField, goNext, canGoNext }: Props) {
  const { t } = useTranslation();
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canGoNext) {
      goNext();
    }
  };

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
          onKeyDown={handleKeyDown}
          placeholder={t('step1.name_placeholder')}
          autoFocus
        />
      </div>

      <div className="input-group">
        <label className="input-label">{t('step1.phone')} *</label>
        <PhoneInput
          defaultCountry="mx"
          value={formData.contactPhone}
          onChange={(phone) => updateField('contactPhone', phone)}
          inputProps={{
            onKeyDown: handleKeyDown
          }}
          placeholder={t('step1.phone_placeholder')}
        />
      </div>
    </div>
  );
}
