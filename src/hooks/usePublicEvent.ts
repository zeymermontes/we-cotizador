import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { PublicEvent, EventLanguage } from '../lib/events-types';

export type PublicEventState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; event: PublicEvent };

/** Carga un evento publicado por su slug (vista events_public). */
export function usePublicEvent(slug: string | undefined): PublicEventState {
  const [state, setState] = useState<PublicEventState>(() => (slug ? { status: 'loading' } : { status: 'missing' }));

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    supabase
      .from('events_public')
      .select('*')
      .eq('slug', slug)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setState(data ? { status: 'ready', event: data as PublicEvent } : { status: 'missing' });
      });
    return () => { cancelled = true; };
  }, [slug]);

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
