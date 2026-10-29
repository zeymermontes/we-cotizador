import RichText from './RichText';
import { previewEl } from '../../lib/preview';
import { pickLocalized, elementShown, elementSize, elementFont, metaStacked, type PublicEvent, type EventLanguage } from '../../lib/events-types';
import { RSVP_DEFAULTS, rsvpTexts, type RsvpConfig } from '../../lib/rsvp';

// Pantalla de confirmación (VIP o registrado por formulario): portada,
// pregunta con dos botones y mensaje final. La misma la usa la vista previa
// de Diseño con un invitado ficticio.

export interface ConfirmGuest { name: string | null; party_size: number; response: 'yes' | 'no' | null; vip: boolean }

interface Props {
  event: PublicEvent;
  lang: EventLanguage;
  config: RsvpConfig;
  guest: ConfirmGuest | null;
  error?: string;
  busy?: '' | 'yes' | 'no';
  changing?: boolean;
  onAnswer: (r: 'yes' | 'no') => void;
  onChange: () => void;
}

export default function ConfirmView({ event, lang, config, guest, error, busy = '', changing = false, onAnswer, onChange }: Props) {
  const t = RSVP_DEFAULTS[lang === 'en' ? 'en' : 'es'];
  const texts = rsvpTexts(config, guest?.vip ?? true);
  const name = guest?.name ?? '';
  const fill = (s: string) => s.replace(/\{\{nombre\}\}/g, name).replace(/\{\{evento\}\}/g, event.name).replace(/^Hola ,\s*/, 'Hola, ').replace(/^Hi ,\s*/, 'Hi, ');
  const sc = event.screens?.confirm;
  const dateStr = event.event_date ? new Date(event.event_date).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const showDate = elementShown(sc, 'date') && !!dateStr;
  const showVenue = elementShown(sc, 'venue') && !!event.venue;
  const logoSize = elementSize(sc, 'logo');
  const answered = !!guest?.response && !changing;
  const yesLabel = pickLocalized(texts.yes_label, lang, t.yes);
  const noLabel = pickLocalized(texts.no_label, lang, t.no);

  return (
    <div className="reg-welcome animate-fade-in">
      {elementShown(sc, 'logo') && event.branding?.logo_url && (
        <img {...previewEl('confirm', 'logo')} src={event.branding.logo_url} alt="" className="branded-logo" style={{ ...(logoSize ? { maxHeight: logoSize } : {}), ...elementFont(sc, 'logo') }} />
      )}
      {elementShown(sc, 'title') && <h1 {...previewEl('confirm', 'title')} style={elementFont(sc, 'title')}>{event.name}</h1>}
      {(showDate || showVenue) && (
        <div className={`reg-meta ${metaStacked(sc) ? 'stacked' : ''}`}>
          {showDate && <span {...previewEl('confirm', 'date')} style={elementFont(sc, 'date')}>{dateStr}</span>}
          {showDate && showVenue && !metaStacked(sc) && <span className="reg-meta-sep"> · </span>}
          {showVenue && <span {...previewEl('confirm', 'venue')} style={elementFont(sc, 'venue')}>{event.venue}</span>}
        </div>
      )}

      {error && <div className="reg-error" style={{ marginTop: 20 }}>{error}</div>}
      {!error && !guest && <p className="reg-hint" style={{ marginTop: 20 }}>…</p>}

      {guest && answered && (
        <div className="rsvp-done">
          <div {...previewEl('confirm', 'buttons')} className={`rsvp-choice ${guest.response === 'yes' ? 'yes' : 'no'}`} style={elementFont(sc, 'buttons')}>
            {guest.response === 'yes' ? `✓ ${yesLabel}` : noLabel}
          </div>
          {elementShown(sc, 'message') && (
            <p {...previewEl('confirm', 'message')} className="rsvp-message" style={elementFont(sc, 'message')}>
              <RichText text={fill(pickLocalized(guest.response === 'yes' ? texts.message_yes : texts.message_no, lang, guest.response === 'yes' ? t.message_yes : t.message_no))} />
            </p>
          )}
          {guest.response === 'yes' && guest.party_size > 1 && <p className="reg-hint">{guest.party_size} {t.people}</p>}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={onChange}>{t.change}</button>
        </div>
      )}

      {guest && !answered && (
        <div className="rsvp-ask">
          {elementShown(sc, 'question') && <p {...previewEl('confirm', 'question')} className="rsvp-question" style={elementFont(sc, 'question')}><RichText text={fill(pickLocalized(texts.question, lang, t.question))} /></p>}
          <div {...previewEl('confirm', 'buttons')} className="rsvp-buttons">
            <button type="button" className="btn btn-primary" style={elementFont(sc, 'buttons')} disabled={!!busy} onClick={() => onAnswer('yes')}>{busy === 'yes' ? '…' : yesLabel}</button>
            <button type="button" className="btn btn-secondary" style={elementFont(sc, 'buttons')} disabled={!!busy} onClick={() => onAnswer('no')}>{busy === 'no' ? '…' : noLabel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
