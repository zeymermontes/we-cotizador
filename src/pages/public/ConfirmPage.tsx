import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandedShell, { ShellMessage } from '../../components/public/BrandedShell';
import RichText from '../../components/public/RichText';
import { usePublicEvent, useEventLanguage } from '../../hooks/usePublicEvent';
import { pickLocalized, elementShown, elementSize, elementFont } from '../../lib/events-types';
import { rsvpGet, rsvpAnswer, RSVP_DEFAULTS, type RsvpInfo, type RsvpConfig } from '../../lib/rsvp';

// Confirmación VIP: portada del evento + "asistiré / no asistiré" + mensaje.
// Sin formulario: la identidad viene del token del enlace.

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

  const cfg: RsvpConfig = info?.config ?? {};
  const name = info?.guest.name ?? '';
  const fill = (s: string) => s.replace(/\{\{nombre\}\}/g, name).replace(/\{\{evento\}\}/g, event.name).replace(/^Hola ,\s*/, 'Hola, ').replace(/^Hi ,\s*/, 'Hi, ');
  const w = event.screens?.welcome;
  const dateStr = event.event_date ? new Date(event.event_date).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const showDate = elementShown(w, 'date') && !!dateStr;
  const showVenue = elementShown(w, 'venue') && !!event.venue;
  const logoSize = elementSize(w, 'logo');
  const answered = info?.guest.response && !changing;

  return (
    <BrandedShell event={event} lang={lang} onLang={setLang} title={`${event.name} · ${lang === 'es' ? 'Confirmación' : 'RSVP'}`} variant="form">
      <div className="reg-welcome animate-fade-in">
        {elementShown(w, 'logo') && event.branding?.logo_url && (
          <img src={event.branding.logo_url} alt="" className="branded-logo" style={{ ...(logoSize ? { maxHeight: logoSize } : {}), ...elementFont(w, 'logo') }} />
        )}
        <h1 style={elementFont(w, 'title')}>{event.name}</h1>
        {(showDate || showVenue) && (
          <div className="reg-meta">
            {showDate && <span style={elementFont(w, 'date')}>{dateStr}</span>}
            {showDate && showVenue && <span className="reg-meta-sep"> · </span>}
            {showVenue && <span style={elementFont(w, 'venue')}>{event.venue}</span>}
          </div>
        )}

        {error && <div className="reg-error" style={{ marginTop: 20 }}>{error}</div>}
        {!error && !info && <p className="reg-hint" style={{ marginTop: 20 }}>…</p>}

        {info && answered && (
          <div className="rsvp-done">
            <div className={`reg-check ${info.guest.response === 'no' ? 'muted' : ''}`}>{info.guest.response === 'yes' ? '✓' : '·'}</div>
            <p className="rsvp-message"><RichText text={fill(pickLocalized(info.guest.response === 'yes' ? cfg.message_yes : cfg.message_no, lang, info.guest.response === 'yes' ? t.message_yes : t.message_no))} /></p>
            {info.guest.response === 'yes' && info.guest.party_size > 1 && <p className="reg-hint">{info.guest.party_size} {t.people}</p>}
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => setChanging(true)}>{t.change}</button>
          </div>
        )}

        {info && !answered && (
          <div className="rsvp-ask">
            <p className="rsvp-question"><RichText text={fill(pickLocalized(cfg.question, lang, t.question))} /></p>
            <div className="rsvp-buttons">
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => answer('yes')}>{busy === 'yes' ? '…' : pickLocalized(cfg.yes_label, lang, t.yes)}</button>
              <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => answer('no')}>{busy === 'no' ? '…' : pickLocalized(cfg.no_label, lang, t.no)}</button>
            </div>
          </div>
        )}
      </div>
    </BrandedShell>
  );
}
