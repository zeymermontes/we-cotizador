import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../hooks/useAuth';
import { publicUrls } from '../../../../lib/host';
import type { EventRow } from '../../../../lib/events-types';
import {
  type FormSchema, type Question, type QuestionType, type Lang, type Ending, type Answers,
  normalizeSchema, validateSchema, newQuestion, starterQuestions, uid, flattenConditions, isGroup, text,
  type ConditionGroup, type ConditionNode,
} from '../../../../lib/form-types';
import QuestionList from './QuestionList';
import QuestionEditor, { Switch } from './QuestionEditor';
import TypePalette from './TypePalette';
import FormPreview from './FormPreview';
import FormFlow from './FormFlow';

interface Props {
  event: EventRow;
}

type SaveState = 'loading' | 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
const HISTORY_MAX = 60;

/** Quita de un grupo toda condición que apunte a `id` (recursivo). */
function stripRefs(g: ConditionGroup | null | undefined, id: string): ConditionGroup | null {
  if (!g) return null;
  const conditions: ConditionNode[] = [];
  for (const n of g.conditions) {
    if (isGroup(n)) { const sub = stripRefs(n, id); if (sub && sub.conditions.length) conditions.push(sub); }
    else if (n.questionId !== id) conditions.push(n);
  }
  return conditions.length ? { ...g, conditions } : null;
}

export default function FormBuilder({ event }: Props) {
  const { session, isSuper } = useAuth();
  const langs: Lang[] = event.languages;

  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [publishedSchema, setPublishedSchema] = useState<FormSchema | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [publishing, setPublishing] = useState(false);
  const [flash, setFlash] = useState('');
  const [view, setView] = useState<'editor' | 'flow'>('editor');
  const [deleting, setDeleting] = useState<Question | null>(null);
  const [traffic, setTraffic] = useState<{ answers: Answers; lang: Lang }[] | null>(null);
  const [conflictBy, setConflictBy] = useState<string>('');
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const saveTimer = useRef<number | null>(null);
  const lastSaved = useRef<string>('');
  const lastUpdatedAt = useRef<string | null>(null);
  const undoStack = useRef<FormSchema[]>([]);
  const redoStack = useRef<FormSchema[]>([]);
  const conflictRef = useRef(false);

  // ─── Carga (crea el borrador si no existe) ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('event_forms').select('draft, published_version, updated_at').eq('event_id', event.id).maybeSingle();
      if (cancelled) return;
      let draft: FormSchema;
      let version: number | null = null;
      if (data) {
        draft = normalizeSchema(data.draft);
        version = data.published_version;
        lastUpdatedAt.current = data.updated_at;
      } else {
        draft = { v: 1, questions: starterQuestions(langs), settings: normalizeSchema({}).settings };
        const { data: ins } = await supabase.from('event_forms').insert({ event_id: event.id, draft, updated_by: session?.user.id ?? null }).select('updated_at').single();
        lastUpdatedAt.current = ins?.updated_at ?? null;
      }
      if (version) {
        const { data: v } = await supabase.from('form_versions').select('schema').eq('event_id', event.id).eq('version', version).maybeSingle();
        if (v && !cancelled) setPublishedSchema(normalizeSchema(v.schema));
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

  // ─── Bloqueo suave: ¿alguien más guardó? ───────────────────
  const describeEditor = useCallback(async (userId: string | null) => {
    if (!userId || userId === session?.user.id) return '';
    if (!isSuper) return 'otro administrador';
    const { data } = await supabase.from('profiles').select('email, full_name').eq('id', userId).maybeSingle();
    return data?.full_name || data?.email || 'otro administrador';
  }, [session?.user.id, isSuper]);

  const markConflict = useCallback(async (userId: string | null) => {
    conflictRef.current = true;
    setConflictBy(await describeEditor(userId));
    setSaveState('conflict');
  }, [describeEditor]);

  useEffect(() => {
    const id = window.setInterval(async () => {
      if (!lastUpdatedAt.current || conflictRef.current) return;
      const { data } = await supabase.from('event_forms').select('updated_at, updated_by').eq('event_id', event.id).maybeSingle();
      if (data && data.updated_at !== lastUpdatedAt.current && data.updated_by !== session?.user.id) markConflict(data.updated_by);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [event.id, session?.user.id, markConflict]);

  // ─── Autoguardado con detección de conflicto ───────────────
  const persist = useCallback(async (s: FormSchema, force = false) => {
    const json = JSON.stringify(s);
    if (json === lastSaved.current && !force) { if (!conflictRef.current) setSaveState('saved'); return true; }
    if (conflictRef.current && !force) return false;
    setSaveState('saving');
    let q = supabase.from('event_forms').update({ draft: s, updated_by: session?.user.id ?? null }).eq('event_id', event.id);
    if (!force && lastUpdatedAt.current) q = q.eq('updated_at', lastUpdatedAt.current);
    const { data, error } = await q.select('updated_at').maybeSingle();
    if (error) { setSaveState('error'); return false; }
    if (!data) {
      const { data: cur } = await supabase.from('event_forms').select('updated_by').eq('event_id', event.id).maybeSingle();
      await markConflict(cur?.updated_by ?? null);
      return false;
    }
    conflictRef.current = false;
    setConflictBy('');
    lastUpdatedAt.current = data.updated_at;
    lastSaved.current = json;
    setSaveState('saved');
    return true;
  }, [event.id, session?.user.id, markConflict]);

  const update = useCallback((next: FormSchema, opts?: { skipHistory?: boolean }) => {
    setSchema(prev => {
      if (prev && !opts?.skipHistory) {
        undoStack.current.push(prev);
        if (undoStack.current.length > HISTORY_MAX) undoStack.current.shift();
        redoStack.current = [];
      }
      return next;
    });
    if (!conflictRef.current) setSaveState('dirty');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { persist(next); }, 800);
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  }, [persist]);

  const undo = useCallback(() => {
    setSchema(cur => {
      const prev = undoStack.current.pop();
      if (!prev || !cur) return cur;
      redoStack.current.push(cur);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => { persist(prev); }, 800);
      return prev;
    });
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  }, [persist]);
  const redo = useCallback(() => {
    setSchema(cur => {
      const next = redoStack.current.pop();
      if (!next || !cur) return cur;
      undoStack.current.push(cur);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => { persist(next); }, 800);
      return next;
    });
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  }, [persist]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  // ─── Linter en vivo ────────────────────────────────────────
  const issues = useMemo(() => (schema ? validateSchema(schema, langs) : []), [schema, langs]);
  const issuesByQuestion = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const i of issues) if (i.questionId) { const cur = m.get(i.questionId); if (!cur || (cur === 'warning' && i.level === 'error')) m.set(i.questionId, i.level); }
    return m;
  }, [issues]);
  const errorCount = issues.filter(i => i.level === 'error').length;
  const warningCount = issues.length - errorCount;

  const loadTraffic = useCallback(async () => {
    const { data } = await supabase.from('registrations').select('answers, lang').eq('event_id', event.id).neq('status', 'cancelled');
    setTraffic(((data ?? []) as { answers: Answers; lang: Lang }[]));
  }, [event.id]);

  if (!schema) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Cargando formulario…</div>;

  const questions = schema.questions;
  const selected = questions.find(q => q.id === selectedId) ?? null;
  const selectedIndex = selected ? questions.indexOf(selected) : -1;
  const hasUnpublished = JSON.stringify(publishedSchema) !== JSON.stringify(schema);
  const endings = schema.settings.endings ?? [];
  const canUndo = history.undo > 0;
  const canRedo = history.redo > 0;

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

  /** Qué depende de una pregunta (para avisar antes de borrarla). */
  function dependentsOf(id: string): { q: Question; why: string }[] {
    const out: { q: Question; why: string }[] = [];
    for (const q of questions) {
      if (q.id === id) continue;
      const whys: string[] = [];
      if (flattenConditions(q.showIf).some(c => c.questionId === id)) whys.push('"mostrar solo si"');
      if ((q.logic ?? []).some(r => flattenConditions(r).some(c => c.questionId === id))) whys.push('una regla de salto');
      if ((q.logic ?? []).some(r => r.jumpTo === id)) whys.push('es destino de un salto');
      if ((q.options ?? []).some(o => flattenConditions(o.showIf).some(c => c.questionId === id))) whys.push('la condición de una opción');
      if (whys.length) out.push({ q, why: whys.join(', ') });
    }
    return out;
  }

  function deleteQuestion(id: string) {
    const idx = questions.findIndex(q => q.id === id);
    const next = questions.filter(q => q.id !== id).map(q => ({
      ...q,
      showIf: stripRefs(q.showIf, id),
      logic: (q.logic ?? []).filter(r => r.jumpTo !== id).map(r => ({ ...r, ...(stripRefs(r, id) ?? { match: r.match, conditions: [] }) })).filter(r => r.conditions.length > 0),
      options: q.options?.map(o => ({ ...o, showIf: stripRefs(o.showIf, id) })),
    }));
    setQuestions(next);
    setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null);
    setDeleting(null);
  }

  function requestDelete(q: Question) {
    if (dependentsOf(q.id).length === 0) { if (confirm('¿Eliminar esta pregunta?')) deleteQuestion(q.id); return; }
    setDeleting(q);
  }

  function duplicateQuestion(q: Question) {
    const copy: Question = { ...structuredClone(q), id: uid(), identity: null, logic: [], key: undefined, options: q.options?.map(o => ({ ...o, id: uid('o') })) };
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
    if (found.some(i => i.level === 'error')) { setShowIssues(true); setFlash('Hay errores que corregir antes de publicar.'); return; }
    setPublishing(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const ok = await persist(current);
    if (!ok) { setPublishing(false); return; }
    const { data, error } = await supabase.rpc('publish_event_form', { p_event_id: event.id });
    setPublishing(false);
    if (error) { setFlash('Error al publicar: ' + error.message); return; }
    setPublishedVersion(data as number);
    setPublishedSchema(current);
    setFlash(`Versión ${data} publicada${event.status !== 'published' ? '. Recuerda publicar el evento para que sea visible.' : ''}`);
  }

  async function reloadFromServer() {
    const { data } = await supabase.from('event_forms').select('draft, updated_at').eq('event_id', event.id).maybeSingle();
    if (!data) return;
    const draft = normalizeSchema(data.draft);
    lastUpdatedAt.current = data.updated_at;
    lastSaved.current = JSON.stringify(draft);
    undoStack.current = []; redoStack.current = [];
    setHistory({ undo: 0, redo: 0 });
    conflictRef.current = false;
    setSchema(draft);
    setSaveState('saved');
    setConflictBy('');
  }

  function setEnding(i: number, patch: Partial<Ending>) {
    if (!schema) return;
    const next = (schema.settings.endings ?? []).map((e, k) => (k === i ? { ...e, ...patch } : e));
    update({ ...schema, settings: { ...schema.settings, endings: next } });
  }

  const urls = publicUrls(event.slug);
  const stateText: Record<SaveState, string> = {
    loading: 'Cargando…', saved: 'Borrador guardado ✓', dirty: 'Cambios sin guardar…', saving: 'Guardando…', error: 'Error al guardar. Revisa tu conexión.', conflict: 'Conflicto: no se guardó',
  };

  return (
    <div>
      {saveState === 'conflict' && (
        <div className="conflict-banner">
          <span>⚠️ {conflictBy || 'Otro administrador'} guardó cambios en este formulario mientras lo editabas. Tus últimos cambios no se han guardado.</span>
          <button className="btn btn-secondary btn-xs" onClick={reloadFromServer}>Cargar su versión (pierdo lo mío)</button>
          <button className="btn btn-primary btn-xs" onClick={() => schema && persist(schema, true)}>Sobrescribir con la mía</button>
        </div>
      )}

      <div className="builder-topbar">
        <span className="builder-status">{stateText[saveState]}</span>
        <span className="builder-status">
          {publishedVersion ? `Publicada v${publishedVersion}${hasUnpublished ? ' · hay cambios sin publicar' : ''}` : 'Nunca publicado'}
        </span>
        <button className={`lint-badge ${errorCount ? 'error' : warningCount ? 'warning' : 'ok'}`} onClick={() => setShowIssues(s => !s)} title="Revisión automática del formulario">
          {errorCount ? `⛔ ${errorCount}` : ''}{errorCount && warningCount ? ' · ' : ''}{warningCount ? `⚠️ ${warningCount}` : ''}{!errorCount && !warningCount ? '✓ sin problemas' : ''}
        </button>
        <span className="spacer" />
        <button className="btn btn-ghost btn-xs" onClick={undo} disabled={!canUndo} title="Deshacer (Ctrl+Z)">↶</button>
        <button className="btn btn-ghost btn-xs" onClick={redo} disabled={!canRedo} title="Rehacer (Ctrl+Shift+Z)">↷</button>
        <div className="segmented">
          <button type="button" className={view === 'editor' ? 'active' : ''} onClick={() => setView('editor')}>✎ Editor</button>
          <button type="button" className={view === 'flow' ? 'active' : ''} onClick={() => setView('flow')}>⤳ Flujo</button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>⚙ Ajustes</button>
        {publishedVersion && event.status === 'published' && (
          <a className="btn btn-secondary btn-sm" href={urls.registro} target="_blank" rel="noopener noreferrer">Ver en vivo ↗</a>
        )}
        <button className="btn btn-primary btn-sm" onClick={publish} disabled={publishing || errorCount > 0 || (!hasUnpublished && !!publishedVersion)}>
          {publishing ? 'Publicando…' : publishedVersion ? 'Publicar cambios' : 'Publicar'}
        </button>
      </div>

      {flash && <div className="inline-alert info">{flash}</div>}

      {showIssues && issues.length > 0 && (
        <div className={`inline-alert ${errorCount ? 'error' : 'info'}`}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <b style={{ flex: 1 }}>{errorCount ? 'Corrige esto antes de publicar:' : 'Avisos (no bloquean):'}</b>
            <button className="btn btn-ghost btn-xs" onClick={() => setShowIssues(false)}>✕</button>
          </div>
          <ul className="issue-list">
            {issues.map((i, k) => (
              <li key={k}>
                <span>{i.level === 'error' ? '⛔' : '⚠️'}</span>
                <span>{i.message}{' '}
                  {i.questionId && <button onClick={() => { setSelectedId(i.questionId!); setAdding(false); setView('editor'); }}>ir</button>}
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
          issues={issues}
          published={publishedSchema}
          traffic={traffic}
          onSelect={id => { setSelectedId(id); setAdding(false); }}
          onEdit={id => { setSelectedId(id); setAdding(false); setView('editor'); }}
          onEditEnding={() => setShowSettings(true)}
          onLoadTraffic={loadTraffic}
        />
      ) : (
        <div className="builder">
          <QuestionList
            questions={questions}
            selectedId={adding ? null : selectedId}
            lang={langs[0]}
            issues={issuesByQuestion}
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
              endings={endings}
              onChange={changeQuestion}
              onDelete={() => requestDelete(selected)}
              onDuplicate={() => duplicateQuestion(selected)}
            />
          )}

          <FormPreview schema={schema} event={event} />
        </div>
      )}

      {deleting && (
        <div className="modal-backdrop" onClick={() => setDeleting(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h2>Eliminar "{text(deleting.title, langs[0]) || 'esta pregunta'}"</h2>
            <p className="text-muted text-sm">Otras preguntas dependen de ella. Si la eliminas, estas referencias se limpian solas y conviene revisarlas:</p>
            <ul className="dep-list">
              {dependentsOf(deleting.id).map(d => (
                <li key={d.q.id}>
                  <span><b>#{questions.indexOf(d.q) + 1}</b> {text(d.q.title, langs[0]) || d.q.type}</span>
                  <span className="text-muted text-xs">{d.why}</span>
                  <button className="btn btn-ghost btn-xs" onClick={() => { setSelectedId(d.q.id); setDeleting(null); setView('editor'); }}>ir</button>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setDeleting(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" style={{ background: 'var(--color-error)', color: '#fff' }} onClick={() => deleteQuestion(deleting.id)}>Eliminar y limpiar referencias</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
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

            <div className="editor-section">
              <h4>Pantalla final</h4>
              <p className="section-hint">Lo que ve la persona al terminar. Puedes usar <code>{'{{nombre}}'}</code> y <code>{'{{evento}}'}</code>. Vacío = "¡Listo, {'{{nombre}}'}!". El estilo (tamaño, fuente, palomita) se ajusta en Diseño.</p>
              {langs.map(l => (
                <div key={l} className="lang-input">
                  {langs.length > 1 && <span className="lang-tag">{l.toUpperCase()}</span>}
                  <input className="input-field" style={{ padding: '6px 0' }} value={schema.settings.ending?.title?.[l] ?? ''} placeholder={l === 'es' ? 'Título · ¡Listo, {{nombre}}!' : 'Title · All set, {{nombre}}!'} onChange={ev => update({ ...schema, settings: { ...schema.settings, ending: { ...(schema.settings.ending ?? {}), title: { ...(schema.settings.ending?.title ?? {}), [l]: ev.target.value } } } })} />
                  <textarea className="input-field" rows={2} style={{ padding: '6px 0', fontSize: 'var(--text-sm)' }} value={schema.settings.ending?.subtitle?.[l] ?? ''} placeholder={l === 'es' ? 'Mensaje · Tu registro quedó guardado.' : 'Message · Your registration has been saved.'} onChange={ev => update({ ...schema, settings: { ...schema.settings, ending: { ...(schema.settings.ending ?? {}), subtitle: { ...(schema.settings.ending?.subtitle ?? {}), [l]: ev.target.value } } } })} />
                </div>
              ))}
            </div>

            <div className="editor-section">
              <h4>Finales alternativos</h4>
              <p className="section-hint">Pantallas de cierre distintas a "Gracias". Un salto puede terminar en cualquiera ("ir a → Final: …"). Útil para cupo lleno, no cumple requisitos, VIP, etc.</p>
              {endings.map((e, i) => (
                <div key={e.id} className="ending-row">
                  <div>
                    <input className="input-field" style={{ padding: '6px 0', fontWeight: 600 }} value={e.name ?? ''} placeholder="Nombre interno (ej. VIP)" onChange={ev => setEnding(i, { name: ev.target.value })} />
                    {langs.map(l => (
                      <div key={l} className="lang-input">
                        {langs.length > 1 && <span className="lang-tag">{l.toUpperCase()}</span>}
                        <input className="input-field" style={{ padding: '6px 0' }} value={e.title[l] ?? ''} placeholder="Título" onChange={ev => setEnding(i, { title: { ...e.title, [l]: ev.target.value } })} />
                        <input className="input-field" style={{ padding: '6px 0' }} value={e.subtitle?.[l] ?? ''} placeholder="Mensaje" onChange={ev => setEnding(i, { subtitle: { ...(e.subtitle ?? {}), [l]: ev.target.value } })} />
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-ghost btn-xs" onClick={() => update({ ...schema, settings: { ...schema.settings, endings: endings.filter((_, k) => k !== i) } })}>✕</button>
                </div>
              ))}
              <button className="btn btn-secondary btn-xs" style={{ marginTop: 8 }} onClick={() => update({ ...schema, settings: { ...schema.settings, endings: [...endings, { id: uid('end'), name: '', title: {}, subtitle: {} }] } })}>+ Final alternativo</button>
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
