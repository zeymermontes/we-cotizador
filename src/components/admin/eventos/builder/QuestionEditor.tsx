import { useState } from 'react';
import type { Question, QuestionType, Lang, Localized, Identity, ChoiceOption } from '../../../../lib/form-types';
import { QUESTION_TYPES, TYPE_INFO, IDENTITY_LABEL, identityOptionsFor, isChoice, newOption, uid } from '../../../../lib/form-types';
import { uploadEventImage, removeEventImage } from '../../../../lib/images';
import LogicEditor from './LogicEditor';

interface Props {
  question: Question;
  index: number;
  questions: Question[];
  langs: Lang[];
  eventId: string;
  onChange: (q: Question) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

const LANG_TAG: Record<Lang, string> = { es: 'ES', en: 'EN' };

export default function QuestionEditor({ question: q, index, questions, langs, eventId, onChange, onDelete, onDuplicate }: Props) {
  const info = TYPE_INFO[q.type];
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch });
  const setLoc = (field: 'title' | 'description' | 'placeholder' | 'buttonLabel', lang: Lang, value: string) =>
    set({ [field]: { ...(q[field] ?? {}), [lang]: value } as Localized });

  const identities = identityOptionsFor(q.type);
  const usedIdentities = new Set(questions.filter(x => x.id !== q.id && x.identity).map(x => x.identity as Identity));

  function changeType(type: QuestionType) {
    const next: Question = { ...q, type };
    if (isChoice(type) && !next.options?.length) next.options = [newOption(langs, 'Opción 1', 'Option 1'), newOption(langs, 'Opción 2', 'Option 2')];
    if (!identityOptionsFor(type).includes(next.identity as Identity)) next.identity = null;
    if (type === 'statement' || type === 'hidden') next.required = false;
    if (type === 'rating' && !next.ratingSteps) { next.ratingSteps = 5; next.ratingIcon = 'star'; }
    onChange(next);
  }

  return (
    <div className="builder-editor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="item-icon" style={{ width: 32, height: 32, fontSize: 14 }}>{info.icon}</span>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600 }}>PREGUNTA {index + 1}</div>
          <select className="glass-select" value={q.type} onChange={e => changeType(e.target.value as QuestionType)}>
            {QUESTION_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </div>
        <button className="btn btn-ghost btn-xs" onClick={onDuplicate}>Duplicar</button>
        <button className="btn btn-ghost btn-xs" style={{ color: 'var(--color-error)' }} onClick={onDelete}>Eliminar</button>
      </div>

      {q.type === 'hidden' ? (
        <div className="input-group">
          <label className="input-label">Nombre del parámetro en la URL</label>
          <input className="input-field" value={q.key ?? ''} onChange={e => set({ key: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} placeholder="utm_source" />
          <div className="text-muted text-xs">Ejemplo: registro.we.page/mi-evento?<b>{q.key || 'utm_source'}</b>=instagram</div>
        </div>
      ) : (
        <>
          <LocField label={q.type === 'legal' ? 'Texto a aceptar' : 'Título'} langs={langs} value={q.title} onChange={(l, v) => setLoc('title', l, v)} big />
          <LocField label="Descripción (opcional)" langs={langs} value={q.description} onChange={(l, v) => setLoc('description', l, v)} textarea />
        </>
      )}

      {(q.type === 'short_text' || q.type === 'long_text' || q.type === 'email' || q.type === 'number') && (
        <LocField label="Placeholder (opcional)" langs={langs} value={q.placeholder} onChange={(l, v) => setLoc('placeholder', l, v)} />
      )}

      {q.type === 'statement' && (
        <LocField label="Texto del botón" langs={langs} value={q.buttonLabel} onChange={(l, v) => setLoc('buttonLabel', l, v)} />
      )}

      {q.type !== 'hidden' && (
        <ImageRow eventId={eventId} value={q.image ?? null} onChange={url => set({ image: url })} />
      )}

      {isChoice(q.type) && (
        <OptionsEditor q={q} langs={langs} eventId={eventId} onChange={set} />
      )}

      {q.type === 'number' && (
        <div className="field-grid" style={{ marginTop: 12 }}>
          <div className="input-group"><label className="input-label">Mínimo</label><input className="input-field" type="number" value={q.min ?? ''} onChange={e => set({ min: e.target.value === '' ? null : Number(e.target.value) })} /></div>
          <div className="input-group"><label className="input-label">Máximo</label><input className="input-field" type="number" value={q.max ?? ''} onChange={e => set({ max: e.target.value === '' ? null : Number(e.target.value) })} /></div>
        </div>
      )}

      {q.type === 'rating' && (
        <div className="field-grid" style={{ marginTop: 12 }}>
          <div className="input-group">
            <label className="input-label">Escala</label>
            <select className="glass-select" value={q.ratingSteps ?? 5} onChange={e => set({ ratingSteps: Number(e.target.value) })}>
              {[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>1 a {n}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Ícono</label>
            <select className="glass-select" value={q.ratingIcon ?? 'star'} onChange={e => set({ ratingIcon: e.target.value as Question['ratingIcon'] })}>
              <option value="star">★ Estrellas</option>
              <option value="heart">♥ Corazones</option>
              <option value="number">Números</option>
            </select>
          </div>
        </div>
      )}

      {q.type !== 'statement' && q.type !== 'hidden' && (
        <div className="editor-section">
          <Switch label="Obligatoria" hint="El invitado no puede avanzar sin responder." checked={q.required} onChange={v => set({ required: v })} />
          {identities.length > 0 && (
            <div className="switch-row">
              <div>Usar como<small>Se guarda en su propia columna para buscar, enviar mensajes y armar la invitación.</small></div>
              <select className="glass-select" value={q.identity ?? ''} onChange={e => set({ identity: (e.target.value || null) as Identity | null })}>
                <option value="">— No —</option>
                {identities.map(i => (
                  <option key={i} value={i} disabled={usedIdentities.has(i)}>{IDENTITY_LABEL[i]}{usedIdentities.has(i) ? ' (ya usado)' : ''}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <LogicEditor question={q} index={index} questions={questions} lang={langs[0]} onChange={onChange} />
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────

function LocField({ label, langs, value, onChange, big, textarea }: {
  label: string; langs: Lang[]; value: Localized | undefined; onChange: (l: Lang, v: string) => void; big?: boolean; textarea?: boolean;
}) {
  return (
    <div className="input-group" style={{ marginTop: 10 }}>
      <label className="input-label">{label}</label>
      {langs.map(l => (
        <div key={l} className="lang-input">
          {langs.length > 1 && <span className="lang-tag">{LANG_TAG[l]}</span>}
          {textarea ? (
            <textarea className="input-field" rows={2} value={value?.[l] ?? ''} onChange={e => onChange(l, e.target.value)} style={{ fontSize: 'var(--text-sm)' }} />
          ) : (
            <input className="input-field" value={value?.[l] ?? ''} onChange={e => onChange(l, e.target.value)} style={big ? { fontSize: 'var(--text-lg)', fontWeight: 500 } : undefined} />
          )}
        </div>
      ))}
    </div>
  );
}

export function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row" style={{ cursor: 'pointer' }}>
      <div>{label}{hint && <small>{hint}</small>}</div>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="slider" />
      </span>
    </label>
  );
}

function ImageRow({ eventId, value, onChange }: { eventId: string; value: string | null; onChange: (url: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const prev = value;
      const up = await uploadEventImage(eventId, 'question', file);
      onChange(up.url);
      if (prev) removeEventImage(prev).catch(() => {});
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="switch-row" style={{ marginTop: 6 }}>
      <div>Imagen de apoyo<small>Se muestra debajo del título. Se comprime sola.</small>{err && <small style={{ color: 'var(--color-error)' }}>{err}</small>}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {value && <img src={value} alt="" style={{ height: 36, borderRadius: 6 }} />}
        {value && <button className="btn btn-ghost btn-xs" onClick={() => { removeEventImage(value).catch(() => {}); onChange(null); }}>Quitar</button>}
        <label className="btn btn-secondary btn-xs" style={{ cursor: 'pointer' }}>
          {busy ? 'Subiendo…' : value ? 'Cambiar' : 'Subir'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handle(e.target.files?.[0])} disabled={busy} />
        </label>
      </div>
    </div>
  );
}

function OptionsEditor({ q, langs, eventId, onChange }: { q: Question; langs: Lang[]; eventId: string; onChange: (p: Partial<Question>) => void }) {
  const options = q.options ?? [];
  const setOpts = (o: ChoiceOption[]) => onChange({ options: o });
  const update = (i: number, patch: Partial<ChoiceOption>) => setOpts(options.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= options.length) return;
    const next = [...options]; [next[i], next[j]] = [next[j], next[i]]; setOpts(next);
  };
  const add = () => setOpts([...options, { id: uid('o'), label: {} }]);

  async function upload(i: number, file: File | undefined) {
    if (!file) return;
    try {
      const up = await uploadEventImage(eventId, 'question', file, `opt-${i}`);
      const prev = options[i].image;
      update(i, { image: up.url });
      if (prev) removeEventImage(prev).catch(() => {});
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <div className="editor-section">
      <h4>Opciones</h4>
      <p className="section-hint">Enter agrega la siguiente. Puedes ponerles imagen para que se vean como tarjetas.</p>
      {options.map((o, i) => (
        <div key={o.id} className="option-row">
          <span className="item-num">{String.fromCharCode(65 + (i % 26))}</span>
          <div className="option-inputs">
            {langs.map(l => (
              <div key={l} className="lang-input" style={{ marginBottom: 0 }}>
                {langs.length > 1 && <span className="lang-tag">{LANG_TAG[l]}</span>}
                <input
                  className="input-field"
                  value={o.label[l] ?? ''}
                  onChange={e => update(i, { label: { ...o.label, [l]: e.target.value } })}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                  placeholder={`Opción ${i + 1}`}
                />
              </div>
            ))}
          </div>
          {o.image ? (
            <img src={o.image} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6, cursor: 'pointer' }} title="Quitar imagen" onClick={() => { removeEventImage(o.image).catch(() => {}); update(i, { image: null }); }} />
          ) : (
            <label className="btn btn-ghost btn-xs" style={{ cursor: 'pointer' }} title="Imagen">🖼
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => upload(i, e.target.files?.[0])} />
            </label>
          )}
          <button className="btn btn-ghost btn-xs" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
          <button className="btn btn-ghost btn-xs" onClick={() => move(i, 1)} disabled={i === options.length - 1}>↓</button>
          <button className="btn btn-ghost btn-xs" onClick={() => setOpts(options.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-xs" onClick={add}>+ Opción</button>

      <div style={{ marginTop: 10 }}>
        <Switch label='Permitir "Otro"' hint="Agrega una opción abierta donde el invitado escribe." checked={!!q.allowOther} onChange={v => onChange({ allowOther: v })} />
        {q.type === 'multiple_choice' && (
          <div className="switch-row">
            <div>Máximo de selecciones<small>Vacío = sin límite.</small></div>
            <input className="input-field" type="number" min={1} style={{ width: 80, padding: '6px 0' }} value={q.maxSelections ?? ''} onChange={e => onChange({ maxSelections: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
        )}
      </div>
    </div>
  );
}
