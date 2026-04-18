import { useTranslation } from 'react-i18next';
import type { QuotationFormData, ReferralSource } from '../../../lib/quotation-types';

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
}

const SOURCES: ReferralSource[] = ['redes_sociales', 'wedding_planner', 'invitacion_we', 'recomendacion', 'otra'];

export default function ReferralStep({ formData, updateField }: Props) {
  const { t } = useTranslation();

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{t('step2.title')}</h2>
        <p className="step-subtitle">{t('step2.subtitle')}</p>
      </div>

      {SOURCES.map(source => (
        <div
          key={source}
          className={`option-card ${formData.referralSource === source ? 'selected' : ''}`}
          onClick={() => updateField('referralSource', source)}
        >
          <div className="option-radio" />
          <div className="option-content">
            <div className="option-title">{t(`step2.${source}`)}</div>
          </div>
        </div>
      ))}

      {formData.referralSource === 'wedding_planner' && (
        <div className="input-group animate-fade-in" style={{ marginTop: 8 }}>
          <label className="input-label">{t('step2.wedding_planner_name')} *</label>
          <input
            className="input-field"
            type="text"
            value={formData.weddingPlannerName}
            onChange={(e) => updateField('weddingPlannerName', e.target.value)}
            placeholder={t('step2.wedding_planner_placeholder')}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
