import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../hooks/useAuth';
import { publicUrls } from '../../../../lib/host';
import type { EventRow } from '../../../../lib/events-types';
import {
  type FormSchema, type Question, type QuestionType, type SchemaIssue, type Lang,
  normalizeSchema, validateSchema, newQuestion, starterQuestions, uid,
} from '../../../../lib/form-types';
import QuestionList from './QuestionList';
import QuestionEditor, { Switch } from './QuestionEditor';
import TypePalette from './TypePalette';
import FormPreview from './FormPreview';
import FormFlow from './FormFlow';

interface Props {
  event: EventRow;
}

type SaveState = 'loading' | 'saved' | 'dirty' | 'saving' | 'error';

export default function FormBuilder({ event }: Props) {
  const { session } = useAuth();
  const langs: Lang[] = event.languages;

  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [publishedJson, setPublishedJson] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<'editor' | 'flow'>('editor');
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [issues, setIssues] = useState<SchemaIssue[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [flash, setFlash] = useState('');
  const saveTimer = useRef<number | null>(null);
  const lastSaved = useRef<string>('');

  // ─── Carga (crea el borrador si no existe) ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('event_forms').select('draft, published_version').eq('event_id', event.id).maybeSingle();
      if (cancelled) return;
      let draft: FormSchema;
      let version: number | null = null;
      if (data) {
        draft = normalizeSchema(data.draft);
        version = data.published_version;
      } else {
        draft = { v: 1, questions: starterQuestions(langs), settings: normalizeSchema({}).settings };
        await supabase.from('event_forms').insert({ event_id: event.id, draft, updated_by: session?.user.id ?? null });
      }
      if (version) {
        const { data: v } = await supabase.from('form_versions').select('schema').eq('event_id', event.id).eq('version', version).maybeSingle();
        if (v && !cancelled) setPublishedJson(JSON.stringify(normalizeSchema(v.schema)));
      }
      if (cancelled) return;
      lastSaved.current = JSON.stringify(draft);
      setSchema(draft);
      setPublishedVersion(version);
      setSelectedId(draft.questions[0]?.id ?? null);
      setSaveState('saved');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  // ─── Autoguardado ──────────────────────────────────────────
  const persist = useCallback(async (s: FormSchema) => {
    const json = JSON.stringify(s);
    if (json === lastSaved.current) { setSaveState('saved'); return; }
    setSaveState('saving');
    const { error } = await supabase.from('event_forms')
      .update({ draft: s, updated_by: session?.user.id ?? null })
      .eq('event_id', event.id);
    if (error) { setSaveState('error'); return; }
    lastSaved.current = json;
    setSaveState('saved');
  }, [event.id, session?.user.id]);

  const update = useCallback((next: FormSchema) => {
    setSchema(next);
    setSaveState('dirty');
    setIssues(null);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persist(next), 800);
  }, [persist]);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  if (!schema) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Cargando formulario…</div>;

  const questions = schema.questions;
  const selected = questions.find(q => q.id === selectedId) ?? null;
  const selectedIndex = selected ? questions.indexOf(selected) : -1;
  const hasUnpublished = publishedJson !== JSON.stringify(schema);

  const setQuestions = (qs: Question[]) => update({ ...schema, questions: qs });

  function addQuestion(type: QuestionType) {
    const q = newQuestion(type, langs);
    const at = selectedIndex >= 0 ? selectedIndex + 1 : questions.length;
    const next = [...questions];
    next.splice(at, 0, q);
    setQuestions(next);
    setSelectedId(q.id);
    setAdding(false);
  }

  function changeQuestion(q: Question) {
    setQuestions(questions.map(x => (x.id === q.id ? q : x)));
  }

  function deleteQuestion(id: string) {
    const idx = questions.findIndex(q => q.id === id);
    const next = questions.filter(q => q.id !== id);
    // Limpia referencias de lógica a la pregunta borrada
    const cleaned = next.map(q => ({
      ...q,
      showIf: q.showIf ? { ...q.showIf, conditions: q.showIf.conditions.filter(c => c.questionId !== id) } : q.showIf,
      logic: (q.logic ?? []).filter(r => r.jumpTo !== id).map(r => ({ ...r, conditions: r.conditions.filter(c => c.questionId !== id) })),
    }));
    setQuestions(cleaned);
    setSelectedId(cleaned[Math.min(idx, cleaned.length - 1)]?.id ?? null);
  }

  function duplicateQuestion(q: Question) {
    const copy: Question = {
      ...structuredClone(q),
      id: uid(),
      identity: null,
      logic: [],
      options: q.options?.map(o => ({ ...o, id: uid('o') })),
    };
    const idx = questions.indexOf(q);
    const next = [...questions];
    next.splice(idx + 1, 0, copy);
    setQuestions(next);
    setSelectedId(copy.id);
  }

  async function publish() {
    if (!schema) return;
    const current = schema;
    const found = validateSchema(current, langs);
    setIssues(found);
    if (found.some(i => i.level === 'error')) return;
    setPublishing(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    await persist(current);
    const { data, error } = await supabase.rpc('publish_event_form', { p_event_id: event.id });
    setPublishing(false);
    if (error) { setFlash('Error al publicar: ' + error.message); return; }
    setPublishedVersion(data as number);
    setPublishedJson(JSON.stringify(current));
    setIssues(null);
    setFlash(`Versión ${data} publicada${event.status !== 'published' ? '. Recuerda publicar el evento para que sea visible.' : ''}`);
  }

  const urls = publicUrls(event.slug);
  const stateText: Record<SaveState, string> = {
    loading: 'Cargando…', saved: 'Borrador guardado ✓', dirty: 'Cambios sin guardar…', saving: 'Guardando…', error: 'Error al guardar. Revisa tu conexión.',
  };

  return (
    <div>
      <div className="builder-topbar">
        <span className="builder-status">{stateText[saveState]}</span>
        <span className="builder-status">
          {publishedVersion ? `Publicada v${publishedVersion}${hasUnpublished ? ' · hay cambios sin publicar' : ''}` : 'Nunca publicado'}
        </span>
        <span className="spacer" />
        <div className="segmented">
          <button type="button" className={view === 'editor' ? 'active' : ''} onClick={() => setView('editor')}>✎ Editor</button>
          <button type="button" className={view === 'flow' ? 'active' : ''} onClick={() => setView('flow')}>⤳ Flujo</button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>⚙ Ajustes</button>
        {publishedVersion && event.status === 'published' && (
          <a className="btn btn-secondary btn-sm" href={urls.registro} target="_blank" rel="noopener noreferrer">Ver en vivo ↗</a>
        )}
        <button className="btn btn-primary btn-sm" onClick={publish} disabled={publishing || (!hasUnpublished && !!publishedVersion)}>
          {publishing ? 'Publicando…' : publishedVersion ? 'Publicar cambios' : 'Publicar'}
        </button>
      </div>

      {flash && <div className="inline-alert info">{flash}</div>}

      {issues && issues.length > 0 && (
        <div className={`inline-alert ${issues.some(i => i.level === 'error') ? 'error' : 'info'}`}>
          <b>{issues.some(i => i.level === 'error') ? 'Corrige esto antes de publicar:' : 'Publicado con avisos:'}</b>
          <ul className="issue-list">
            {issues.map((i, k) => (
              <li key={k}>
                <span>{i.level === 'error' ? '⛔' : '⚠️'}</span>
                <span>{i.message}{' '}
                  {i.questionId && <button onClick={() => { setSelectedId(i.questionId!); setAdding(false); }}>ir</button>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === 'flow' ? (
        <FormFlow
          schema={schema}
          lang={langs[0]}
          selectedId={selectedId}
          onSelect={id => { setSelectedId(id); setAdding(false); setView('editor'); }}
        />
      ) : (
      <div className="builder">
        <QuestionList
          questions={questions}
          selectedId={adding ? null : selectedId}
          lang={langs[0]}
          onSelect={id => { setSelectedId(id); setAdding(false); }}
          onReorder={setQuestions}
          onAdd={() => setAdding(true)}
        />

        {adding || !selected ? (
          <div className="builder-editor">
            <TypePalette onPick={addQuestion} onCancel={selected ? () => setAdding(false) : undefined} />
          </div>
        ) : (
          <QuestionEditor
            key={selected.id}
            question={selected}
            index={selectedIndex}
            questions={questions}
            langs={langs}
            eventId={event.id}
            onChange={changeQuestion}
            onDelete={() => { if (confirm('¿Eliminar esta pregunta?')) deleteQuestion(selected.id); }}
            onDuplicate={() => duplicateQuestion(selected)}
          />
        )}

        <FormPreview schema={schema} event={event} />
      </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h2>Ajustes del formulario</h2>
            <Switch label="Barra de progreso" checked={schema.settings.showProgress} onChange={v => update({ ...schema, settings: { ...schema.settings, showProgress: v } })} />
            <Switch label="Contador de preguntas" hint='"Pregunta 3 de 8"' checked={schema.settings.showStepCounter} onChange={v => update({ ...schema, settings: { ...schema.settings, showStepCounter: v } })} />
            <Switch label="Atajos de teclado" hint="Letras A, B, C para elegir; Enter para avanzar." checked={schema.settings.keyboardShortcuts} onChange={v => update({ ...schema, settings: { ...schema.settings, keyboardShortcuts: v } })} />
            <div className="switch-row">
              <div>Registros duplicados<small>Qué pasa si alguien se registra dos veces.</small></div>
              <select className="glass-select" value={schema.settings.duplicates} onChange={e => update({ ...schema, settings: { ...schema.settings, duplicates: e.target.value as FormSchema['settings']['duplicates'] } })}>
                <option value="allow">Permitir</option>
                <option value="block_email">Bloquear por correo</option>
                <option value="block_phone">Bloquear por teléfono</option>
                <option value="block_both">Bloquear por correo o teléfono</option>
              </select>
            </div>
            <div className="input-group" style={{ marginTop: 12 }}>
              <label className="input-label">Texto del botón final</label>
              {langs.map(l => (
                <input key={l} className="input-field" style={{ padding: '8px 0' }} placeholder={l === 'es' ? 'Enviar' : 'Submit'} value={schema.settings.submitLabel?.[l] ?? ''} onChange={e => update({ ...schema, settings: { ...schema.settings, submitLabel: { ...(schema.settings.submitLabel ?? {}), [l]: e.target.value } } })} />
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary btn-sm" onClick={() => setShowSettings(false)}>Listo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
