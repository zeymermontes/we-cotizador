import { useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import type { FormSchema, Lang } from '../../../../lib/form-types';
import { text } from '../../../../lib/form-types';
import {
  type Registration, type RegistrationStatus,
  STATUS_ORDER, STATUS_LABEL, STATUS_BADGE, answerText,
} from '../../../../lib/registrations';
import { useAuth } from '../../../../hooks/useAuth';
import type { EventRow } from '../../../../lib/events-types';
import { genericSettings, regenerateInvitation, removeInvitation, downloadInvitation } from '../../../../lib/invitations';

interface Props {
  registration: Registration;
  schema: FormSchema | null;
  lang: Lang;
  /** Para regenerar la invitación con el diseño del evento */
  event?: EventRow;
  onClose: () => void;
  onChanged: (r: Registration) => void;
  onDeleted: (id: string) => void;
}

export default function RegistrationDrawer({ registration: r, schema, lang, event, onClose, onChanged, onDeleted }: Props) {
  const { isSuper } = useAuth();
  const [invBusy, setInvBusy] = useState('');
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

  async function reloadInvitation() {
    const { data } = await supabase.from('registrations').select('qr_url, invitation_url, invitation_drive_id, invitation_drive_url').eq('id', r.id).maybeSingle();
    if (data) onChanged({ ...r, ...data });
  }

  async function invitationAction(kind: 'download' | 'regenerate' | 'remove') {
    setInvBusy(kind);
    try {
      if (kind === 'download') await downloadInvitation(r);
      if (kind === 'regenerate') {
        if (!event) throw new Error('Abre la ficha desde el evento para regenerar');
        const res = await regenerateInvitation(event, r, genericSettings(event.invitation_config), lang);
        if (res.failed) throw new Error('No se pudo generar la invitación');
        if (res.drive_error) alert(`Invitación lista. Copia a Drive pendiente: ${res.drive_error}`);
        await reloadInvitation();
      }
      if (kind === 'remove') {
        if (!confirm('¿Quitar la invitación de este registro? El QR se conserva; podrás generarla de nuevo.')) { setInvBusy(''); return; }
        await removeInvitation(r);
        onChanged({ ...r, invitation_url: null, invitation_drive_id: null, invitation_drive_url: null });
      }
    } catch (e) { alert((e as Error).message); }
    setInvBusy('');
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
              {r.qr_url ? (
                <Row label="QR" value={
                  <a href={r.qr_url} target="_blank" rel="noopener noreferrer" title="Abrir el QR en grande" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <img src={r.qr_url} alt="QR" style={{ width: 56, height: 56, borderRadius: 6, background: '#fff' }} />
                    <span>abrir ↗</span>
                  </a>
                } />
              ) : r.qr_token ? <Row label="QR" value="generado ✓" /> : null}
              {r.invitation_url && (
                <Row label="Invitación" value={
                  <a href={r.invitation_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {/\.(png|jpe?g|webp)(\?|$)/i.test(r.invitation_url) && <img src={r.invitation_url} alt="Invitación" style={{ width: 56, height: 84, objectFit: 'cover', borderRadius: 6 }} />}
                    <span>{/\.(png|jpe?g|webp)(\?|$)/i.test(r.invitation_url) ? 'abrir imagen ↗' : 'abrir PDF ↗'}</span>
                  </a>
                } />
              )}
              {r.invitation_drive_url && <Row label="En Drive" value={<a href={r.invitation_drive_url} target="_blank" rel="noopener noreferrer">abrir copia ↗</a>} />}
              {isSuper && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 6 }}>
                  {r.invitation_url && <button className="btn btn-secondary btn-xs" disabled={!!invBusy} onClick={() => invitationAction('download')}>{invBusy === 'download' ? '…' : '⬇ Descargar'}</button>}
                  {event && <button className="btn btn-secondary btn-xs" disabled={!!invBusy} onClick={() => invitationAction('regenerate')}>{invBusy === 'regenerate' ? 'Generando…' : r.invitation_url ? '↻ Regenerar invitación' : '🖼 Generar invitación'}</button>}
                  {r.invitation_url && <button className="btn btn-ghost btn-xs" disabled={!!invBusy} onClick={() => invitationAction('remove')} style={{ color: 'var(--color-error)' }}>Quitar invitación</button>}
                </div>
              )}
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
      <span className="detail-info-value">{value || <span className="text-muted">—</span>}</span>
    </div>
  );
}
