import { useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandedShell, { ShellMessage } from '../../components/public/BrandedShell';
import { usePublicEvent, useEventLanguage } from '../../hooks/usePublicEvent';
import { pickLocalized } from '../../lib/events-types';

const COPY = {
  es: {
    missing: 'Este evento no está disponible',
    title: 'Control de acceso',
    subtitle: 'Escribe el PIN del staff para empezar a escanear.',
    enter: 'Entrar',
    soon: 'El scanner se activa en la fase 6. El PIN ya se puede configurar desde el admin.',
  },
  en: {
    missing: 'This event is not available',
    title: 'Check-in',
    subtitle: 'Enter the staff PIN to start scanning.',
    enter: 'Enter',
    soon: 'The scanner goes live in phase 6. The PIN can already be set from the admin.',
  },
};

export default function AccesoPage() {
  const { slug } = useParams<{ slug: string }>();
  const state = usePublicEvent(slug);
  const event = state.status === 'ready' ? state.event : null;
  const [lang, setLang] = useEventLanguage(event);
  const [pin, setPin] = useState('');
  const c = COPY[lang];

  if (state.status === 'loading') {
    return <BrandedShell event={null}><ShellMessage title="…" /></BrandedShell>;
  }
  if (state.status === 'missing' || !event) {
    return <BrandedShell event={null} title="We.Page"><ShellMessage title={c.missing} /></BrandedShell>;
  }

  const title = pickLocalized(event.screens?.scanner?.title, lang, c.title);
  const subtitle = pickLocalized(event.screens?.scanner?.subtitle, lang, c.subtitle);

  return (
    <BrandedShell event={event} lang={lang} onLang={setLang} title={`${title} · ${event.name}`}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>{title}</h1>
      <p style={{ opacity: 0.7 }}>{event.name}</p>
      <p style={{ opacity: 0.7, marginTop: 8 }}>{subtitle}</p>

      <form onSubmit={e => e.preventDefault()}>
        <input
          className="pin-input"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="••••"
          autoFocus
        />
        <button className="branded-btn" type="submit" disabled title={c.soon}>{c.enter} →</button>
      </form>
      <p style={{ marginTop: 16, fontSize: 12, opacity: 0.5 }}>{c.soon}</p>
    </BrandedShell>
  );
}
