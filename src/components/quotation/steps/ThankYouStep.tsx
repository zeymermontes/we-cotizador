import { useTranslation } from 'react-i18next';
import logo from '../../../assets/logo.png';

export default function ThankYouStep() {
  const { t } = useTranslation();

  return (
    <div className="thank-you animate-fade-in">
      <div className="form-logo" style={{ justifyContent: 'center', marginBottom: 'var(--space-lg)' }}>
        <img src={logo} alt="We.Page Logo" style={{ height: 80 }} />
      </div>
      <h1>{t('thank_you.title')}</h1>
      <p className="step-subtitle" style={{ marginBottom: 16 }}>{t('thank_you.subtitle')}</p>
      <p className="text-muted">{t('thank_you.message')}</p>
      <p className="text-muted text-sm" style={{ marginTop: 8 }}>{t('thank_you.note')}</p>

      <div className="thank-you-contact">
        <a
          href="https://www.instagram.com/we.page.mx/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 'var(--text-sm)', color: '#000' }}
        >
          📸 {t('thank_you.instagram')}
        </a>
        <a
          href="https://wa.me/523315807471"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 'var(--text-sm)', color: '#000' }}
        >
          📱 {t('thank_you.whatsapp')}
        </a>
      </div>
    </div>
  );
}
