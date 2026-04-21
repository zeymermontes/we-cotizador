import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotationFormData } from '../../../lib/quotation-types';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';

// Register locales
registerLocale('es', es);
registerLocale('en', enUS);

interface Props {
  formData: QuotationFormData;
  updateField: <K extends keyof QuotationFormData>(field: K, value: QuotationFormData[K]) => void;
}

// Custom input component that doesn't trigger the keyboard
const CustomDateInput = forwardRef(({ value, onClick, placeholder }: any, ref: any) => (
  <button
    type="button"
    className="input-field"
    onClick={onClick}
    ref={ref}
    style={{ 
      textAlign: 'left', 
      cursor: 'pointer',
      display: 'block',
      width: '100%',
      borderBottom: '2px solid var(--border-default)',
      background: 'transparent'
    }}
  >
    {value || <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>}
  </button>
));

export default function EventDateStep({ formData, updateField }: Props) {
  const { t, i18n } = useTranslation();
  
  // Convert ISO string back to Date object for the picker
  const selectedDate = formData.eventDate ? new Date(formData.eventDate) : null;
  const currentLocale = i18n.language === 'en' ? 'en' : 'es';

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{t('step4.title')}</h2>
        <p className="step-subtitle">{t('step4.subtitle')}</p>
      </div>

      <div className="input-group">
        <label className="input-label">{t('step4.date_label')} *</label>
        <DatePicker
          selected={selectedDate}
          onChange={(date: Date | null) => updateField('eventDate', date ? date.toISOString() : '')}
          minDate={new Date()}
          dateFormat="dd/MM/yyyy"
          placeholderText={t('step4.date_label')}
          className="input-field"
          locale={currentLocale}
          autoFocus={false}
          isClearable
          showPopperArrow={false}
          customInput={<CustomDateInput placeholder={t('step4.date_label')} />}
        />
      </div>
    </div>
  );
}
