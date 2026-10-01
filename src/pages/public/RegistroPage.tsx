import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import BrandedShell, { ShellMessage } from '../../components/public/BrandedShell';
import FormRunner, { type SubmitResult } from '../../components/public/FormRunner';
import { usePublicEvent, useEventLanguage } from '../../hooks/usePublicEvent';
import { type FormSchema, type Answers, normalizeSchema } from '../../lib/form-types';
import type { EventBranding, EventScreens, EventLanguage } from '../../lib/events-types';

/** Mensaje que manda el admin al iframe de vista previa. */
export interface PreviewMessage {
  type: 'we-preview';
  branding?: EventBranding;
  screens?: EventScreens;
  stage?: 'welcome' | 'done';
  lang?: EventLanguage;
}

const IS_PREVIEW = new URLSearchParams(window.location.search).get('preview') === '1';

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
  const state = usePublicEvent(slug, IS_PREVIEW);
  const loaded = state.status === 'ready' ? state.event : null;
  const [override, setOverride] = useState<Omit<PreviewMessage, 'type'>>({});
  // En vista previa el admin manda branding y textos sin guardar; se pintan encima de lo cargado.
  const event = useMemo(() => (loaded && IS_PREVIEW ? { ...loaded, branding: override.branding ?? loaded.branding, screens: override.screens ?? loaded.screens } : loaded), [loaded, override]);
  const [langSaved, setLang] = useEventLanguage(event);
  const lang = IS_PREVIEW && override.lang ? override.lang : langSaved;
  const [form, setForm] = useState<FormState>({ status: 'loading' });
  const c = COPY[lang];

  useEffect(() => {
    if (!IS_PREVIEW) return;
    const onMessage = (e: MessageEvent<PreviewMessage>) => {
      if (e.data?.type !== 'we-preview') return;
      const { branding, screens, stage, lang: l } = e.data;
      setOverride({ branding, screens, stage, lang: l });
    };
    window.addEventListener('message', onMessage);
    window.parent?.postMessage({ type: 'we-preview-ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!slug || state.status !== 'ready') return;
    let cancelled = false;
    const eventId = state.event.id;
    supabase.from('event_forms_public').select('version, schema').eq('slug', slug).maybeSingle()
      .then(async ({ data }) => {
        if (cancelled) return;
        if (data) { setForm({ status: 'ready', version: data.version, schema: normalizeSchema(data.schema) }); return; }
        if (IS_PREVIEW) {
          // Sin versión publicada, la vista previa enseña el borrador del builder.
          const { data: draft } = await supabase.from('event_forms').select('draft').eq('event_id', eventId).maybeSingle();
          if (cancelled) return;
          if (draft?.draft) { setForm({ status: 'ready', version: 0, schema: normalizeSchema(draft.draft) }); return; }
        }
        setForm({ status: 'missing' });
      });
    return () => { cancelled = true; };
  }, [slug, state]);

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
  if (!IS_PREVIEW && (event.status === 'closed' || closedByDate)) {
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
        key={IS_PREVIEW ? `${lang}-${override.stage ?? 'welcome'}` : lang}
        schema={form.schema}
        event={event}
        lang={lang}
        mode={IS_PREVIEW ? 'preview' : 'live'}
        storageKey={IS_PREVIEW ? undefined : `we-reg-${event.slug}-v${form.version}`}
        hiddenValues={params}
        initialStage={IS_PREVIEW ? override.stage : undefined}
        onSubmit={onSubmit}
      />
    </BrandedShell>
  );
}
