import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import BrandedShell, { ShellMessage } from '../../components/public/BrandedShell';
import FormRunner, { type SubmitResult } from '../../components/public/FormRunner';
import { usePublicEvent, useEventLanguage } from '../../hooks/usePublicEvent';
import { type FormSchema, type Answers, normalizeSchema } from '../../lib/form-types';

const COPY = {
  es: {
    missing: 'Este registro no está disponible',
    missingText: 'Revisa el enlace o pregunta a quien te lo compartió.',
    closed: 'El registro ya cerró',
    closedText: 'Gracias por tu interés. Si crees que es un error, contacta a los organizadores.',
    preparing: 'Estamos preparando el registro',
    preparingText: 'Vuelve a intentar en un momento.',
  },
  en: {
    missing: 'This registration is not available',
    missingText: 'Check the link or ask whoever shared it with you.',
    closed: 'Registration is closed',
    closedText: 'Thanks for your interest. If you think this is a mistake, contact the organizers.',
    preparing: 'Registration is being set up',
    preparingText: 'Please try again in a moment.',
  },
};

type FormState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; version: number; schema: FormSchema };

export default function RegistroPage() {
  const { slug } = useParams<{ slug: string }>();
  const state = usePublicEvent(slug);
  const event = state.status === 'ready' ? state.event : null;
  const [lang, setLang] = useEventLanguage(event);
  const [form, setForm] = useState<FormState>({ status: 'loading' });
  const c = COPY[lang];

  useEffect(() => {
    if (!slug || state.status !== 'ready') return;
    let cancelled = false;
    supabase.from('event_forms_public').select('version, schema').eq('slug', slug).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setForm(data ? { status: 'ready', version: data.version, schema: normalizeSchema(data.schema) } : { status: 'missing' });
      });
    return () => { cancelled = true; };
  }, [slug, state.status]);

  // Campos ocultos y origen desde la URL (utm_source=…, ref=…)
  const params = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    const all: Record<string, string> = {};
    p.forEach((v, k) => { all[k] = v; });
    return all;
  }, []);

  const onSubmit = useCallback(async (answers: Answers, submissionId: string): Promise<SubmitResult> => {
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; code?: string }>('submit-registration', {
      body: {
        slug,
        submission_id: submissionId,
        lang,
        answers,
        source: { ...params, referrer: document.referrer || undefined },
        website: '',
      },
    });
    if (error || !data) return { ok: false, code: 'network' };
    if (!data.ok) return { ok: false, code: data.code ?? 'unknown' };
    return { ok: true };
  }, [slug, lang, params]);

  if (state.status === 'loading' || (state.status === 'ready' && form.status === 'loading')) {
    return <BrandedShell event={event}><ShellMessage title="…" /></BrandedShell>;
  }

  if (state.status === 'missing' || !event) {
    return <BrandedShell event={null} title="We.Page"><ShellMessage title={c.missing} text={c.missingText} /></BrandedShell>;
  }

  const closedByDate = event.registration_closes_at && new Date(event.registration_closes_at) < new Date();
  if (event.status === 'closed' || closedByDate) {
    return (
      <BrandedShell event={event} lang={lang} onLang={setLang}>
        <ShellMessage title={c.closed} text={c.closedText} />
      </BrandedShell>
    );
  }

  if (form.status !== 'ready') {
    return (
      <BrandedShell event={event} lang={lang} onLang={setLang}>
        <ShellMessage title={c.preparing} text={c.preparingText} />
      </BrandedShell>
    );
  }

  return (
    <BrandedShell event={event} lang={lang} onLang={setLang} variant="form">
      <FormRunner
        key={lang}
        schema={form.schema}
        event={event}
        lang={lang}
        mode="live"
        storageKey={`we-reg-${event.slug}-v${form.version}`}
        hiddenValues={params}
        onSubmit={onSubmit}
      />
    </BrandedShell>
  );
}
