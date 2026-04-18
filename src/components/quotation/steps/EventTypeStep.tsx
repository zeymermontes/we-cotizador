import { useTranslation } from 'react-i18next';
import type { QuotationFormData, EventType } from '../../../lib/quotation-types';

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
}

const TYPES: EventType[] = ['boda', 'boda_civil', 'evento_social', 'otros'];

export default function EventTypeStep({ formData, updateField }: Props) {
  const { t } = useTranslation();

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{t('step3.title')}</h2>
        <p className="step-subtitle">{t('step3.subtitle')}</p>
      </div>

      {TYPES.map(type => (
        <div
          key={type}
          className={`option-card ${formData.eventType === type ? 'selected' : ''}`}
          onClick={() => updateField('eventType', type)}
        >
          <div className="option-radio" />
          <div className="option-content">
            <div className="option-title">{t(`step3.${type}`)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
