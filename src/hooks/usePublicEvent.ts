import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { PublicEvent, EventLanguage } from '../lib/events-types';

export type PublicEventState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; event: PublicEvent };

const PUBLIC_COLUMNS = 'id, slug, name, description, event_date, timezone, venue, status, languages, default_language, registration_closes_at, branding, screens';

/** Carga un evento publicado por su slug (vista events_public).
 *  En vista previa (admin con sesión) lee la tabla events, así se ve aunque esté en borrador. */
export function usePublicEvent(slug: string | undefined, preview = false): PublicEventState {
  const [state, setState] = useState<PublicEventState>(() => (slug ? { status: 'loading' } : { status: 'missing' }));

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const fromPublic = () => supabase.from('events_public').select('*').eq('slug', slug).maybeSingle().then(r => r.data as PublicEvent | null);
    const fromTable = () => supabase.from('events').select(PUBLIC_COLUMNS).eq('slug', slug).maybeSingle().then(r => r.data as PublicEvent | null);
    (preview ? fromTable().then(d => d ?? fromPublic()) : fromPublic()).then(data => {
      if (cancelled) return;
      setState(data ? { status: 'ready', event: data } : { status: 'missing' });
    });
    return () => { cancelled = true; };
  }, [slug, preview]);

  return state;
}

/** Idioma elegido por el invitado, con memoria por evento. */
export function useEventLanguage(event: PublicEvent | null): [EventLanguage, (l: EventLanguage) => void] {
  const key = event ? `we-lang-${event.slug}` : '';
  const [lang, setLangState] = useState<EventLanguage>(() => {
    if (!event) return 'es';
    try {
      const saved = key && localStorage.getItem(key);
      if (saved === 'es' || saved === 'en') return event.languages.includes(saved) ? saved : event.default_language;
    } catch { /* sin storage */ }
    const browser = navigator.language.slice(0, 2) as EventLanguage;
    return event.languages.includes(browser) ? browser : event.default_language;
  });

  const setLang = (l: EventLanguage) => {
    setLangState(l);
    try { if (key) localStorage.setItem(key, l); } catch { /* sin storage */ }
  };

  return [lang, setLang];
}
