import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { PublicEvent } from '../../lib/events-types';
import { pickLocalized, elementShown, elementSize, elementFont } from '../../lib/events-types';
import {
  type FormSchema, type Answers, type AnswerValue, type Lang, type AnswerError, type Question, type EvalContext,
  resolveFlowDetailed, validateAnswer, extractIdentity, computeScore, text, isEmpty,
  ERROR_TEXT, RUNNER_TEXT,
} from '../../lib/form-types';
import QuestionInput from './QuestionInput';

export type SubmitResult = { ok: true } | { ok: false; code: string };

interface Props {
  schema: FormSchema;
  event: PublicEvent;
  lang: Lang;
  mode: 'live' | 'preview';
  /** Clave de localStorage para retomar; sin ella no se guarda nada. */
  storageKey?: string;
  hiddenValues?: Record<string, string>;
  /** Pantalla con la que arranca (solo vista previa del admin). */
  initialStage?: 'welcome' | 'done';
  onSubmit: (answers: Answers, submissionId: string) => Promise<SubmitResult>;
}

type Stage = 'welcome' | 'questions' | 'submitting' | 'done' | 'error';

interface Saved { answers: Answers; step: number; stage: Stage; submissionId: string }

/** Convierte un valor de la URL al tipo de la pregunta (opciones por id o por texto). */
function coerceFromUrl(q: Question, raw: string): AnswerValue {
  const v = raw.trim();
  const findOpt = (s: string) => (q.options ?? []).find(o => o.id === s || Object.values(o.label).some(l => (l ?? '').trim().toLowerCase() === s.toLowerCase()))?.id;
  switch (q.type) {
    case 'number': case 'rating': { const n = Number(v); return Number.isFinite(n) ? n : null; }
    case 'yes_no': case 'legal': return ['1', 'true', 'si', 'sí', 'yes'].includes(v.toLowerCase());
    case 'single_choice': case 'dropdown': return findOpt(v) ?? (q.allowOther ? `other:${v}` : null);
    case 'multiple_choice': return v.split(',').map(x => findOpt(x.trim())).filter((x): x is string => !!x);
    default: return v.slice(0, 500);
  }
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function load(key?: string): Saved | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (s.stage === 'done') return null;
    return s;
  } catch { return null; }
}

const DEFAULT_COPY = {
  es: { welcome: 'Regístrate a {{evento}}', welcomeSub: 'Te tomará menos de un minuto.', start: 'Comenzar', thanks: '¡Listo, {{nombre}}!', thanksSub: 'Tu registro quedó guardado.' },
  en: { welcome: 'Register for {{evento}}', welcomeSub: 'It takes less than a minute.', start: 'Start', thanks: 'All set, {{nombre}}!', thanksSub: 'Your registration has been saved.' },
};

export default function FormRunner({ schema, event, lang, mode, storageKey, hiddenValues, initialStage, onSubmit }: Props) {
  const t = RUNNER_TEXT[lang];
  const copy = DEFAULT_COPY[lang];
  const saved = useMemo(() => load(storageKey), [storageKey]);

  const [stage, setStage] = useState<Stage>(saved?.stage === 'questions' ? 'questions' : (initialStage ?? 'welcome'));
  const prefilled = useMemo(() => {
    const set = new Set<string>();
    for (const q of schema.questions) if (q.key && hiddenValues?.[q.key] !== undefined && hiddenValues[q.key] !== '') set.add(q.id);
    return set;
  }, [schema, hiddenValues]);
  const [answers, setAnswers] = useState<Answers>(() => {
    const base: Answers = { ...(saved?.answers ?? {}) };
    for (const q of schema.questions) {
      if (q.key && hiddenValues?.[q.key] !== undefined && hiddenValues[q.key] !== '' && isEmpty(base[q.id])) {
        base[q.id] = coerceFromUrl(q, hiddenValues[q.key]);
      }
    }
    return base;
  });
  const [step, setStep] = useState(saved?.step ?? 0);
  const [error, setError] = useState<AnswerError | null>(null);
  const [submitError, setSubmitError] = useState<string>('');
  const submissionId = useRef(saved?.submissionId ?? newId());
  const commitTimer = useRef<number | null>(null);

  const byId = useMemo(() => new Map(schema.questions.map(q => [q.id, q])), [schema]);
  const flow = useMemo(() => resolveFlowDetailed(schema, answers, { lang, prefilled }), [schema, answers, lang, prefilled]);
  const path = flow.path;
  const ctx: EvalContext = useMemo(() => ({ lang, score: computeScore(schema, answers) }), [lang, schema, answers]);
  const safeStep = Math.min(step, Math.max(0, path.length - 1));
  const currentId = path[safeStep];
  const current = currentId ? byId.get(currentId) : undefined;
  const isLast = safeStep === path.length - 1;

  // Persistencia para retomar
  useEffect(() => {
    if (!storageKey) return;
    try {
      const s: Saved = { answers, step: safeStep, stage, submissionId: submissionId.current };
      if (stage === 'done') localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(s));
    } catch { /* sin storage */ }
  }, [answers, safeStep, stage, storageKey]);

  const setAnswer = useCallback((v: AnswerValue) => {
    if (!currentId) return;
    setAnswers(prev => ({ ...prev, [currentId]: v }));
    setError(null);
  }, [currentId]);

  const submit = useCallback(async (finalAnswers: Answers) => {
    setStage('submitting');
    setSubmitError('');
    if (mode === 'preview') {
      await new Promise(r => setTimeout(r, 500));
      setStage('done');
      return;
    }
    const res = await onSubmit(finalAnswers, submissionId.current);
    if (res.ok) { setStage('done'); return; }
    const known: Record<string, string> = { duplicate: t.duplicate, full: t.full, closed: t.closed };
    setSubmitError(known[res.code] ?? t.error_generic);
    setStage('error');
  }, [mode, onSubmit, t]);

  const goNext = useCallback((override?: Answers) => {
    if (!current) return;
    const a = override ?? answers;
    const err = validateAnswer(current, a[current.id], a, ctx);
    if (err) { setError(err); return; }
    if (isLast) { submit(a); return; }
    setError(null);
    setStep(s => s + 1);
  }, [current, answers, isLast, submit, ctx]);

  /** Atrás: pregunta anterior o, desde la primera, la bienvenida (las respuestas se conservan). */
  const goBack = () => {
    setError(null);
    if (safeStep > 0) setStep(safeStep - 1);
    else setStage('welcome');
  };

  /** Opción cerrada: pequeña pausa para que se vea la selección y avanza. */
  const commit = () => {
    if (isLast) return;
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      setError(null);
      setStep(s => s + 1);
    }, 280);
  };
  useEffect(() => () => { if (commitTimer.current) window.clearTimeout(commitTimer.current); }, []);

  // Atajos de teclado: letras para opciones, Enter para avanzar
  useEffect(() => {
    if (stage !== 'questions' || !current) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (e.key === 'Enter' && !typing) { e.preventDefault(); if (current.type === 'statement') setStep(s => s + 1); else goNext(); return; }
      if (!schema.settings.keyboardShortcuts || typing) return;
      const k = e.key.toUpperCase();
      if (current.type === 'single_choice' || current.type === 'multiple_choice') {
        const idx = k.charCodeAt(0) - 65;
        const opt = (current.options ?? [])[idx];
        if (k.length === 1 && opt) {
          e.preventDefault();
          if (current.type === 'single_choice') { setAnswer(opt.id); commit(); }
          else {
            const cur = Array.isArray(answers[current.id]) ? (answers[current.id] as string[]) : [];
            setAnswer(cur.includes(opt.id) ? cur.filter(x => x !== opt.id) : [...cur, opt.id]);
          }
        }
      } else if (current.type === 'yes_no') {
        if (k === 'Y') { setAnswer(true); commit(); }
        if (k === 'N') { setAnswer(false); commit(); }
      } else if (current.type === 'rating') {
        const n = Number(e.key);
        if (n >= 1 && n <= (current.ratingSteps ?? 5)) { setAnswer(n); commit(); }
      } else if (current.type === 'legal' && k === 'Y') {
        setAnswer(answers[current.id] === true ? null : true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, current, answers, goNext, schema.settings.keyboardShortcuts]);

  const fill = (s: string) => s
    .replace(/\{\{evento\}\}/g, event.name)
    .replace(/\{\{nombre\}\}/g, extractIdentity(schema, answers).name ?? '');

  // ─── Pantallas ─────────────────────────────────────────────

  if (stage === 'welcome') {
    const w = event.screens?.welcome;
    const dateStr = event.event_date
      ? new Date(event.event_date).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    const showDate = elementShown(w, 'date') && !!dateStr;
    const showVenue = elementShown(w, 'venue') && !!event.venue;
    const logoSize = elementSize(w, 'logo');
    return (
      <div className="reg-welcome animate-fade-in">
        {elementShown(w, 'logo') && event.branding?.logo_url && (
          <img src={event.branding.logo_url} alt="" className="branded-logo" style={{ ...(logoSize ? { maxHeight: logoSize } : {}), ...elementFont(w, 'logo') }} />
        )}
        {elementShown(w, 'title') && <h1 style={elementFont(w, 'title')}>{fill(pickLocalized(w?.title, lang, copy.welcome))}</h1>}
        {(showDate || showVenue) && (
          <div className="reg-meta">
            {showDate && <span style={elementFont(w, 'date')}>{dateStr}</span>}
            {showDate && showVenue && <span className="reg-meta-sep"> · </span>}
            {showVenue && <span style={elementFont(w, 'venue')}>{event.venue}</span>}
          </div>
        )}
        {elementShown(w, 'subtitle') && <p style={elementFont(w, 'subtitle')}>{fill(pickLocalized(w?.subtitle, lang, copy.welcomeSub))}</p>}
        <button className="btn btn-primary" style={elementFont(w, 'button')} onClick={() => setStage('questions')} autoFocus>
          {pickLocalized(w?.button, lang, copy.start)} →
        </button>
        {elementShown(w, 'hint') && <div className="reg-hint" style={{ marginTop: 12, ...elementFont(w, 'hint') }}>{t.press_enter}</div>}
      </div>
    );
  }

  if (stage === 'done') {
    const th = event.screens?.thank_you;
    const ending = flow.endingId ? (schema.settings.endings ?? []).find(e => e.id === flow.endingId) : undefined;
    const title = ending ? fill(text(ending.title, lang, copy.thanks)) : fill(pickLocalized(th?.title, lang, copy.thanks));
    const subtitle = ending ? fill(text(ending.subtitle, lang)) : fill(pickLocalized(th?.subtitle, lang, copy.thanksSub));
    const checkSize = elementSize(th, 'check');
    return (
      <div className="reg-thanks animate-fade-in">
        {elementShown(th, 'check') && (
          <div className="reg-check" style={{ ...(checkSize ? { width: checkSize, height: checkSize, fontSize: checkSize * 0.45 } : {}), ...elementFont(th, 'check') }}>✓</div>
        )}
        {elementShown(th, 'title') && <h1 style={elementFont(th, 'title')}>{title.replace(/, !$/, '!')}</h1>}
        {elementShown(th, 'subtitle') && subtitle && <p style={elementFont(th, 'subtitle')}>{subtitle}</p>}
      </div>
    );
  }

  if (stage === 'error') {
    return (
      <div className="reg-thanks animate-fade-in">
        <h1 style={{ fontSize: '1.4rem' }}>{submitError}</h1>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => submit(answers)}>{t.retry}</button>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { setStage('questions'); setStep(0); }}>{t.back}</button>
        </div>
      </div>
    );
  }

  if (!current) {
    return <div className="reg-body"><p className="text-muted">…</p></div>;
  }

  const progress = ((safeStep + 1) / path.length) * 100;
  const title = text(current.title, lang);
  const desc = text(current.description, lang);
  const isStatement = current.type === 'statement';
  const isLongText = current.type === 'long_text';
  const submitting = stage === 'submitting';

  return (
    <>
      {schema.settings.showProgress && (
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
      )}
      <div className="reg-body">
        {schema.settings.showStepCounter && (
          <div className="step-counter">{t.step} {safeStep + 1} {t.of} {path.length}</div>
        )}
        <div key={current.id} className="animate-fade-in" style={{ flex: 1 }}>
          <div className="step-header">
            <h2 className="step-title">
              {title}
              {!current.required && !isStatement && <span className="reg-optional">({t.optional})</span>}
            </h2>
            {desc && <p className="step-subtitle">{desc}</p>}
          </div>
          {current.image && <img src={current.image} alt="" className="question-image" />}

          {!isStatement && (
            <QuestionInput
              q={current}
              value={answers[current.id]}
              lang={lang}
              answers={answers}
              ctx={ctx}
              keyboard={schema.settings.keyboardShortcuts}
              onChange={setAnswer}
              onCommit={commit}
              onEnter={() => goNext()}
            />
          )}
          {error && <div className="reg-error">{ERROR_TEXT[lang][error]}</div>}
        </div>
      </div>

      <div className="reg-footer">
        <div>
          <button className="btn btn-secondary btn-sm" onClick={goBack} disabled={submitting}>← {t.back}</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="reg-hint no-mobile">{isLongText ? t.press_cmd_enter : t.press_enter}</span>
          {isStatement ? (
            <button className="btn btn-primary" onClick={() => (isLast ? submit(answers) : setStep(s => s + 1))} disabled={submitting}>
              {text(current.buttonLabel, lang, t.continue)} →
            </button>
          ) : isLast ? (
            <button className="btn btn-primary" onClick={() => goNext()} disabled={submitting}>
              {submitting ? t.sending : text(schema.settings.submitLabel, lang, t.submit)} →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => goNext()} disabled={submitting || (current.required && isEmpty(answers[current.id]))}>
              {t.ok} ✓
            </button>
          )}
        </div>
      </div>
    </>
  );
}
