import { useTranslation } from 'react-i18next';
import type { QuotationFormData, InvitationFormat } from '../../../lib/quotation-types';

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
}

export default function FormatSelectionStep({ formData, updateField }: Props) {
  const { t } = useTranslation();

  const formats: { value: InvitationFormat; key: string }[] = [
    { value: 'pagina_web', key: 'pagina_web' },
    { value: 'pdf_interactivo', key: 'pdf_interactivo' },
  ];

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{t('step6_format.title')}</h2>
      </div>

      {formats.map(fmt => (
        <div
          key={fmt.value}
          className={`option-card ${formData.invitationFormat === fmt.value ? 'selected' : ''}`}
          onClick={() => updateField('invitationFormat', fmt.value)}
        >
          <div className="option-radio" />
          <div className="option-content">
            <div className="option-title" style={{ fontSize: '1.1rem' }}>
              {t(`step6_format.${fmt.key}`)}
            </div>
            <div className="option-desc">{t(`step6_format.${fmt.key}_desc`)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
