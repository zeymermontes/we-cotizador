import { useTranslation } from 'react-i18next';
import BlurredImage from '../../common/BlurredImage';
import type { QuotationFormData, InvitationFormat } from '../../../lib/quotation-types';
import webImg from '../../../assets/questions/Pag web.webp';
import pdfImg from '../../../assets/questions/pdf interactivo.webp';

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
}

export default function FormatSelectionStep({ formData, updateField }: Props) {
  const { t } = useTranslation();

  const formats: { value: InvitationFormat; key: string; image: string }[] = [
    { value: 'pagina_web', key: 'pagina_web', image: webImg },
    { value: 'pdf_interactivo', key: 'pdf_interactivo', image: pdfImg },
  ];

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{t('step6_format.title')}</h2>
      </div>

      <div className="options-grid force-horizontal">
        {formats.map((fmt, i) => (
          <div
            key={fmt.value}
            className={`option-card has-image ${formData.invitationFormat === fmt.value ? 'selected' : ''} animate-slide-up`}
            style={{ animationDelay: `${i * 100}ms` }}
            onClick={() => updateField('invitationFormat', fmt.value)}
          >
            <div className="option-card-image-wrapper">
              <BlurredImage 
                src={fmt.image} 
                alt={t(`step6_format.${fmt.key}`)} 
                className="option-card-image" 
              />
            </div>
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
    </div>
  );
}
