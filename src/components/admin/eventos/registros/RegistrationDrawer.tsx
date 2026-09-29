import { useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import type { FormSchema, Lang } from '../../../../lib/form-types';
import { text } from '../../../../lib/form-types';
import {
  type Registration, type RegistrationStatus,
  STATUS_ORDER, STATUS_LABEL, STATUS_BADGE, answerText,
} from '../../../../lib/registrations';

interface Props {
  registration: Registration;
  schema: FormSchema | null;
  lang: Lang;
  onClose: () => void;
  onChanged: (r: Registration) => void;
  onDeleted: (id: string) => void;
}

export default function RegistrationDrawer({ registration: r, schema, lang, onClose, onChanged, onDeleted }: Props) {
  const [notes, setNotes] = useState(r.notes ?? '');
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({ name: r.name ?? '', email: r.email ?? '', phone: r.phone ?? '', party_size: r.party_size, company: r.company ?? '' });

  async function patch(p: Partial<Registration>) {
    setBusy(true);
    const { error } = await supabase.from('registrations').update(p).eq('id', r.id);
    setBusy(false);
    if (error) { alert(error.message); return; }
    onChanged({ ...r, ...p });
  }

  async function remove() {
    if (!confirm(`¿Eliminar el registro de ${r.name || 'este invitado'}? No se puede deshacer.`)) return;
    const { error } = await supabase.from('registrations').delete().eq('id', r.id);
    if (error) { alert(error.message); return; }
    onDeleted(r.id);
  }

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || r.tags.includes(t)) { setTagInput(''); return; }
    patch({ tags: [...r.tags, t] });
    setTagInput('');
  };

  const questions = (schema?.questions ?? []).filter(q => q.type !== 'statement');
  const knownIds = new Set(questions.map(q => q.id));
  const orphanAnswers = Object.entries(r.answers).filter(([id]) => !knownIds.has(id));

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <h2>{r.name || 'Sin nombre'}</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
              <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              <span className="text-muted text-xs">
                {new Date(r.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })} · {r.lang.toUpperCase()}
                {r.form_version ? ` · form v${r.form_version}` : ''}
              </span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <h3 style={{ flex: 1, fontSize: 'var(--text-base)' }}>Datos</h3>
            {!editing ? (
              <button className="btn btn-ghost btn-xs" onClick={() => setEditing(true)}>Editar</button>
            ) : (
              <>
                <button className="btn btn-ghost btn-xs" onClick={() => setEditing(false)}>Cancelar</button>
                <button
                  className="btn btn-primary btn-xs"
                  disabled={busy}
                  onClick={async () => {
                    await patch({
                      name: fields.name.trim() || null,
                      email: fields.email.trim().toLowerCase() || null,
                      phone: fields.phone.replace(/[^\d+]/g, '') || null,
                      party_size: Math.max(1, Number(fields.party_size) || 1),
                      company: fields.company.trim() || null,
                    });
                    setEditing(false);
                  }}
                >
                  Guardar
                </button>
              </>
            )}
          </div>
          {editing ? (
            <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="input-group"><label className="input-label">Nombre</label><input className="input-field" value={fields.name} onChange={e => setFields(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="input-group"><label className="input-label">Personas</label><input className="input-field" type="number" min={1} value={fields.party_size} onChange={e => setFields(f => ({ ...f, party_size: Number(e.target.value) }))} /></div>
              <div className="input-group"><label className="input-label">Correo</label><input className="input-field" value={fields.email} onChange={e => setFields(f => ({ ...f, email: e.target.value }))} /></div>
              <div className="input-group"><label className="input-label">Teléfono</label><input className="input-field" value={fields.phone} onChange={e => setFields(f => ({ ...f, phone: e.target.value }))} /></div>
              <div className="input-group"><label className="input-label">Empresa</label><input className="input-field" value={fields.company} onChange={e => setFields(f => ({ ...f, company: e.target.value }))} /></div>
            </div>
          ) : (
            <div className="detail-info-grid" style={{ fontSize: 'var(--text-sm)' }}>
              <Row label="Correo" value={r.email} />
              <Row label="Teléfono" value={r.phone} />
              <Row label="Personas" value={String(r.party_size)} />
              <Row label="Empresa" value={r.company} />
              {r.qr_token && <Row label="QR" value="generado ✓" />}
              {r.invitation_url && <Row label="Invitación" value={<a href={r.invitation_url} target="_blank" rel="noopener noreferrer">abrir PDF ↗</a>} />}
            </div>
          )}
        </div>

        <div className="section-card">
          <h3 style={{ fontSize: 'var(--text-base)' }}>Estatus</h3>
          <select className="glass-select" value={r.status} disabled={busy} onChange={e => patch({ status: e.target.value as RegistrationStatus })}>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>

          <h3 style={{ fontSize: 'var(--text-base)', marginTop: 16 }}>Etiquetas</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {r.tags.map(t => (
              <span key={t} className="tag-chip" style={{ cursor: 'pointer' }} title="Quitar" onClick={() => patch({ tags: r.tags.filter(x => x !== t) })}>{t} ✕</span>
            ))}
            {r.tags.length === 0 && <span className="text-muted text-xs">Sin etiquetas</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input-field" style={{ padding: '6px 0', fontSize: 'var(--text-sm)' }} placeholder="Nueva etiqueta" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} />
            <button className="btn btn-secondary btn-xs" onClick={addTag} disabled={!tagInput.trim()}>Agregar</button>
          </div>

          <h3 style={{ fontSize: 'var(--text-base)', marginTop: 16 }}>Notas internas</h3>
          <textarea className="input-field" rows={3} style={{ fontSize: 'var(--text-sm)' }} value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => { if (notes !== (r.notes ?? '')) patch({ notes: notes || null }); }} placeholder="Solo las ve el equipo" />
        </div>

        <div className="section-card">
          <h3 style={{ fontSize: 'var(--text-base)' }}>Respuestas</h3>
          {questions.map(q => (
            <div key={q.id} className="answer-row">
              <div className="answer-q">{text(q.title, lang) || (q.type === 'hidden' ? `oculto: ${q.key}` : 'Pregunta')}{q.identity ? ` · ${q.identity}` : ''}</div>
              <div className={`answer-a ${answerText(q, r.answers[q.id], lang) ? '' : 'empty'}`}>{answerText(q, r.answers[q.id], lang) || 'sin respuesta'}</div>
            </div>
          ))}
          {orphanAnswers.map(([id, v]) => (
            <div key={id} className="answer-row">
              <div className="answer-q">{id} <span className="text-muted">(pregunta de una versión anterior)</span></div>
              <div className="answer-a">{Array.isArray(v) ? v.join(', ') : String(v)}</div>
            </div>
          ))}
          {Object.keys(r.source ?? {}).length > 0 && (
            <div className="answer-row">
              <div className="answer-q">Origen</div>
              <div className="answer-a text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                {Object.entries(r.source).filter(([k]) => k !== 'ua').map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}
              </div>
            </div>
          )}
        </div>

        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={remove}>Eliminar registro</button>
      </aside>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
      <span className="text-muted" style={{ width: 90, flexShrink: 0 }}>{label}</span>
      <span>{value || <span className="text-muted">—</span>}</span>
    </div>
  );
}
