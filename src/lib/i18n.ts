import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpApi from 'i18next-http-backend';

// Injected by Vite at build time (see vite.config.ts) — changes every build
declare const __BUILD_ID__: string;

i18n
  .use(HttpApi)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: ['es', 'en'],
    fallbackLng: 'es',
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    backend: {
      loadPath: `/locales/{{lng}}/translation.json?v=${__BUILD_ID__}`,
    },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'we_lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
