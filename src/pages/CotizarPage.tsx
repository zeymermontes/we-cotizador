import { useTranslation } from 'react-i18next';
import QuotationWizard from '../components/quotation/QuotationWizard';

import logo from '../assets/logo.png';

export default function CotizarPage() {
  const { i18n } = useTranslation();

  const toggleLang = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <div className="form-page">
      <header className="form-header">
        <div className="form-logo">
          <img src={logo} alt="We.Page Logo" />
        </div>
        <div className="lang-toggle">
          <button
            className={`lang-btn ${i18n.language === 'es' ? 'active' : ''}`}
            onClick={() => toggleLang('es')}
          >
            ES
          </button>
          <button
            className={`lang-btn ${i18n.language === 'en' ? 'active' : ''}`}
            onClick={() => toggleLang('en')}
          >
            EN
          </button>
        </div>
      </header>
      <QuotationWizard />
    </div>
  );
}
