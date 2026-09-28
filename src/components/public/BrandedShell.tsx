import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { type PublicEvent, type EventLanguage, DEFAULT_BRANDING, LANGUAGE_LABEL } from '../../lib/events-types';
import { brandingStyle, fontsHref } from '../../lib/branding';

interface ShellProps {
  event: PublicEvent | null;
  lang?: EventLanguage;
  onLang?: (l: EventLanguage) => void;
  title?: string;
  children: ReactNode;
}

export default function BrandedShell({ event, lang, onLang, title, children }: ShellProps) {
  const b = event?.branding;
  const m = { ...DEFAULT_BRANDING, ...(b ?? {}) };

  useEffect(() => {
    document.title = title ?? (event ? `${event.name} | We.Page` : 'We.Page');
  }, [title, event]);

  const style: CSSProperties = {
    ...brandingStyle(b),
    ...(m.background_url ? { backgroundImage: `url(${m.background_url})` } : {}),
  };

  return (
    <div className="branded-page" style={style}>
      <link rel="stylesheet" href={fontsHref([m.font_display, m.font_body])} />
      <div className="branded-card animate-fade-in">
        {event && event.languages.length > 1 && lang && onLang && (
          <div className="branded-lang">
            {event.languages.map(l => (
              <button key={l} className={l === lang ? 'active' : ''} onClick={() => onLang(l)}>
                {LANGUAGE_LABEL[l]}
              </button>
            ))}
          </div>
        )}
        {m.logo_url && <img src={m.logo_url} alt="" className="branded-logo" />}
        {children}
      </div>
      <p style={{ marginTop: 16, fontSize: 11, opacity: 0.5 }}>Powered by We.Page</p>
    </div>
  );
}

export function ShellMessage({ title, text }: { title: string; text?: string }) {
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', marginBottom: 8 }}>{title}</h1>
      {text && <p style={{ opacity: 0.7 }}>{text}</p>}
    </>
  );
}
