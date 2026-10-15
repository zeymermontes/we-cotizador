import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandedShell, { ShellMessage } from '../../components/public/BrandedShell';
import ConfirmView from '../../components/public/ConfirmView';
import { usePublicEvent, useEventLanguage } from '../../hooks/usePublicEvent';
import { rsvpGet, rsvpAnswer, RSVP_DEFAULTS, type RsvpInfo } from '../../lib/rsvp';

// Confirmación por enlace personal: la identidad viene del token.
export default function ConfirmPage() {
  const { slug, token } = useParams<{ slug: string; token: string }>();
  const state = usePublicEvent(slug);
  const event = state.status === 'ready' ? state.event : null;
  const [lang, setLang] = useEventLanguage(event);
  const [info, setInfo] = useState<RsvpInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'yes' | 'no'>('');
  const [changing, setChanging] = useState(false);
  const t = RSVP_DEFAULTS[lang === 'en' ? 'en' : 'es'];

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    rsvpGet(token).then(res => {
      if (cancelled) return;
      if (res.ok) setInfo(res); else setError(res.code === 'not_found' ? t.invalid : res.message);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function answer(response: 'yes' | 'no') {
    if (!token) return;
    setBusy(response);
    const res = await rsvpAnswer(token, response);
    setBusy('');
    if (!res.ok) { setError(res.code === 'closed' ? t.closed : res.message); return; }
    setInfo(res);
    setChanging(false);
  }

  if (state.status === 'loading') return <BrandedShell event={state.cached} loading />;
  if (state.status === 'missing' || !event) return <BrandedShell event={null} title="We.Page"><ShellMessage title={t.invalid} /></BrandedShell>;

  return (
    <BrandedShell event={event} lang={lang} onLang={setLang} title={`${event.name} · ${lang === 'es' ? 'Confirmación' : 'RSVP'}`} variant="form">
      <ConfirmView
        event={event}
        lang={lang}
        config={info?.config ?? {}}
        guest={info ? { ...info.guest, vip: info.guest.vip ?? true } : null}
        error={error}
        busy={busy}
        changing={changing}
        onAnswer={answer}
        onChange={() => setChanging(true)}
      />
    </BrandedShell>
  );
}
