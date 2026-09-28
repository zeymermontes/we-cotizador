import { useParams } from 'react-router-dom';
import BrandedShell, { ShellMessage } from '../../components/public/BrandedShell';
import { usePublicEvent, useEventLanguage } from '../../hooks/usePublicEvent';
import { pickLocalized } from '../../lib/events-types';

const COPY = {
  es: {
    missing: 'Este registro no está disponible',
    missingText: 'Revisa el enlace o pregunta a quien te lo compartió.',
    closed: 'El registro ya cerró',
    closedText: 'Gracias por tu interés. Si crees que es un error, contacta a los organizadores.',
    soon: 'El formulario de registro se activa en la siguiente fase.',
    start: 'Comenzar',
    welcome: 'Regístrate a {{evento}}',
    welcomeSub: 'Te tomará menos de un minuto.',
  },
  en: {
    missing: 'This registration is not available',
    missingText: 'Check the link or ask whoever shared it with you.',
    closed: 'Registration is closed',
    closedText: 'Thanks for your interest. If you think this is a mistake, contact the organizers.',
    soon: 'The registration form goes live in the next phase.',
    start: 'Start',
    welcome: 'Register for {{evento}}',
    welcomeSub: 'It takes less than a minute.',
  },
};

export default function RegistroPage() {
  const { slug } = useParams<{ slug: string }>();
  const state = usePublicEvent(slug);
  const event = state.status === 'ready' ? state.event : null;
  const [lang, setLang] = useEventLanguage(event);
  const c = COPY[lang];

  if (state.status === 'loading') {
    return <BrandedShell event={null}><ShellMessage title="…" /></BrandedShell>;
  }

  if (state.status === 'missing' || !event) {
    return (
      <BrandedShell event={null} title="We.Page">
        <ShellMessage title={c.missing} text={c.missingText} />
      </BrandedShell>
    );
  }

  const closedByDate = event.registration_closes_at && new Date(event.registration_closes_at) < new Date();
  if (event.status === 'closed' || closedByDate) {
    return (
      <BrandedShell event={event} lang={lang} onLang={setLang}>
        <ShellMessage title={c.closed} text={c.closedText} />
      </BrandedShell>
    );
  }

  const fill = (s: string) => s.replace(/\{\{evento\}\}/g, event.name);
  const title = fill(pickLocalized(event.screens?.welcome?.title, lang, c.welcome));
  const subtitle = fill(pickLocalized(event.screens?.welcome?.subtitle, lang, c.welcomeSub));
  const button = pickLocalized(event.screens?.welcome?.button, lang, c.start);

  return (
    <BrandedShell event={event} lang={lang} onLang={setLang}>
      <h1 style={{ fontSize: '1.8rem', marginBottom: 8 }}>{title}</h1>
      <p style={{ opacity: 0.7, marginBottom: 24 }}>{subtitle}</p>
      <button className="branded-btn" disabled title={c.soon}>{button} →</button>
      <p style={{ marginTop: 16, fontSize: 12, opacity: 0.5 }}>{c.soon}</p>
    </BrandedShell>
  );
}
