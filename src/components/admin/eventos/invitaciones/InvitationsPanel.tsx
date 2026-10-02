import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../../lib/supabase';
import type { EventRow } from '../../../../lib/events-types';
import { type FormSchema, normalizeSchema, text } from '../../../../lib/form-types';
import type { Registration } from '../../../../lib/registrations';
import {
  type InvitationConfig, type InvitationJob, type InspectResult, type PlaceholderMapping,
  FIELD_OPTIONS, JOB_STATUS_LABEL, JOB_STATUS_BADGE, generateQrs, inspectInvitationTemplate, runInvitationBatch,
  slidesConfig, genericSettings, generateGenericInvitations, type GenericProgress,
} from '../../../../lib/invitations';
import { DEFAULT_GENERIC, defaultSubtitle, drawGenericInvitation, type GenericInvitationSettings } from '../../../../lib/invitation-canvas';
import { ExcelModal } from './InvitationActions';
import type { BulkContext } from '../registros/RegistrationsPanel';

interface Props {
  event: EventRow;
  onEventPatch: (fields: Partial<EventRow>, okText?: string) => Promise<boolean>;
}

export default function InvitationsPanel({ event, onEventPatch }: Props) {
  const [regs, setRegs] = useState<Registration[]>([]);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [jobs, setJobs] = useState<InvitationJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: r }, { data: j }, { data: form }] = await Promise.all([
      supabase.from('registrations').select('*').eq('event_id', event.id).order('created_at', { ascending: false }),
      supabase.from('invitation_jobs').select('*').eq('event_id', event.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('event_forms').select('draft, published_version').eq('event_id', event.id).maybeSingle(),
    ]);
    setRegs((r as Registration[]) ?? []);
    setJobs((j as InvitationJob[]) ?? []);
    if (form?.published_version) {
      const { data: v } = await supabase.from('form_versions').select('schema').eq('event_id', event.id).eq('version', form.published_version).maybeSingle();
      setSchema(normalizeSchema(v?.schema ?? form.draft));
    } else setSchema(form ? normalizeSchema(form.draft) : null);
    setLoading(false);
  }, [event.id]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Cargando…</div>;

  const active = regs.filter(r => r.status !== 'cancelled');
  const ctx: BulkContext = { event, schema, selected: [], filtered: active, all: regs, refresh: load, clearSelection: () => {} };

  return (
    <div>
      <QrSection event={event} regs={active} onDone={load} />
      <GenericSection event={event} regs={active} onEventPatch={onEventPatch} onReload={load} />
      <SlidesSection event={event} schema={schema} regs={active} jobs={jobs} onEventPatch={onEventPatch} onReload={load} />
      <ExcelSection ctx={ctx} />
    </div>
  );
}

// ─── QR ──────────────────────────────────────────────────────

function QrSection({ event, regs, onDone }: { event: EventRow; regs: Registration[]; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const withQr = regs.filter(r => r.qr_url).length;
  const missing = regs.length - withQr;

  async function run(force: boolean) {
    if (force && !confirm('Se regenerarán TODOS los QR. Los ya impresos o enviados dejarán de ser válidos. ¿Continuar?')) return;
    setBusy(true);
    try {
      const p = await generateQrs(event.id, { all: true, force }, s => setProgress(`${s.done} generados${s.remaining ? `, faltan ${s.remaining}` : ''}`));
      await onDone();
      setProgress(`Listo: ${p.done} generados${p.failed ? `, ${p.failed} fallidos` : ''}`);
    } catch (e) { setProgress((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="section-card">
      <h3>Códigos QR</h3>
      <p className="section-hint">Un QR único por registro. Se guarda como imagen y se usa en la invitación de Slides y en el correo (variable <code>{'{{qr_url}}'}</code>). El scanner de acceso lo lee en la puerta.</p>
      <div className="stats-grid" style={{ marginBottom: 12 }}>
        <div className="stat-card"><div className="stat-label">Con QR</div><div className="stat-value">{withQr}</div></div>
        <div className="stat-card"><div className="stat-label">Sin QR</div><div className="stat-value">{missing}</div></div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={() => run(false)} disabled={busy || missing === 0}>{busy ? 'Generando…' : `Generar los ${missing} que faltan`}</button>
        <button className="btn btn-ghost btn-xs" onClick={() => run(true)} disabled={busy || regs.length === 0}>Regenerar todos</button>
        {progress && <span className="text-muted text-sm">{progress}</span>}
      </div>
      <p className="text-muted text-xs" style={{ marginTop: 8 }}>Para generar solo algunos: selecciónalos en Registros y usa el botón QR de la barra.</p>
    </div>
  );
}

// ─── Diseño genérico (sin Slides) ───────────────────────────

function GenericSection({ event, regs, onEventPatch, onReload }: {
  event: EventRow; regs: Registration[]; onEventPatch: Props['onEventPatch']; onReload: () => Promise<void>;
}) {
  const lang = event.default_language;
  const [s, setS] = useState<Required<GenericInvitationSettings>>({ ...DEFAULT_GENERIC, ...genericSettings(event.invitation_config) });
  const [preview, setPreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<GenericProgress | null>(null);
  const [error, setError] = useState('');
  const sample = regs.find(r => r.qr_url) ?? regs[0];
  const withInvitation = regs.filter(r => r.invitation_url).length;

  // Vista previa con el primer registro (o un invitado de ejemplo), con pausa para no redibujar en cada tecla
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const guest = sample ? { name: sample.name, party_size: sample.party_size, qr_url: sample.qr_url } : { name: 'Nombre Apellido', party_size: 1, qr_url: null };
        const canvas = await drawGenericInvitation(event, guest, s, lang);
        if (!cancelled) setPreview(canvas.toDataURL('image/jpeg', 0.85));
      } catch (e) { if (!cancelled) setError((e as Error).message); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [event, s, lang, sample]);

  async function save() {
    setSaving(true);
    const current = (event.invitation_config as InvitationConfig | null) ?? ({} as InvitationConfig);
    await onEventPatch({ invitation_config: { ...current, generic: s } }, 'Diseño de invitación guardado');
    setSaving(false);
  }

  function downloadSample() {
    if (!preview) return;
    const a = document.createElement('a');
    a.href = preview;
    a.download = `invitacion-ejemplo-${event.slug}.jpg`;
    a.click();
  }

  async function generate(force: boolean) {
    const targets = regs.filter(r => force || !r.invitation_url);
    if (targets.length === 0) return alert('Todos ya tienen invitación.');
    if (!confirm(`Se generarán ${targets.length} invitaciones con este diseño${force ? ' (reemplazando las existentes)' : ''}. ¿Continuar?`)) return;
    setError('');
    setProgress({ done: 0, failed: 0, total: targets.length });
    try {
      const res = await generateGenericInvitations(event, targets, s, lang, setProgress);
      setProgress(res);
      await onReload();
    } catch (e) { setError((e as Error).message); setProgress(null); }
  }

  const busy = !!progress && progress.done + progress.failed < progress.total;

  return (
    <div className="section-card">
      <h3>Invitación con el diseño del evento</h3>
      <p className="section-hint">
        Sin plantilla de Slides: una imagen por invitado con el fondo, logo, colores y fuentes de Diseño, su nombre y su QR. Lista para mandarse por WhatsApp o correo (variable <code>{'{{invitacion_url}}'}</code>).
      </p>
      <div className="invite-generic">
        <div className="invite-generic-fields">
          <div className="input-group">
            <label className="input-label">Título</label>
            <input className="input-field" value={s.title} onChange={e => setS(x => ({ ...x, title: e.target.value }))} placeholder={event.name} />
          </div>
          <div className="input-group">
            <label className="input-label">Fecha y lugar</label>
            <input className="input-field" value={s.subtitle} onChange={e => setS(x => ({ ...x, subtitle: e.target.value }))} placeholder={defaultSubtitle(event, lang) || 'Vacío = fecha · lugar del evento'} />
          </div>
          <div className="input-group">
            <label className="input-label">Mensaje bajo el QR</label>
            <input className="input-field" value={s.message} onChange={e => setS(x => ({ ...x, message: e.target.value }))} />
          </div>
          <label className="switch-row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={s.show_name} onChange={e => setS(x => ({ ...x, show_name: e.target.checked }))} />
            <span className="text-sm">Mostrar el nombre del invitado</span>
          </label>
          <p className="text-muted text-xs" style={{ marginTop: 8 }}>Fondo, logo, colores y fuentes se toman de la pestaña Diseño. Si hay más de un boleto se indica "Válida para N personas".</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar diseño'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={downloadSample} disabled={!preview}>Descargar ejemplo</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => generate(false)} disabled={busy || regs.length === 0}>
              {busy ? 'Generando…' : `Generar para los ${regs.length - withInvitation} sin invitación`}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => generate(true)} disabled={busy || regs.length === 0}>Regenerar todas</button>
            {progress && (
              <span className="text-muted text-sm">
                {progress.done + progress.failed}/{progress.total}{progress.failed ? ` · ${progress.failed} fallidas` : ''}{busy && progress.current ? ` · ${progress.current}` : ''}
              </span>
            )}
          </div>
          {error && <div className="inline-alert error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <div className="invite-generic-preview">
          {preview ? <img src={preview} alt="Vista previa de la invitación" /> : <div className="text-muted text-sm">Dibujando vista previa…</div>}
          <span className="text-muted text-xs">{sample ? `Ejemplo con ${sample.name ?? 'el primer registro'}` : 'Ejemplo con un invitado ficticio'} · 1080×1620</span>
        </div>
      </div>
    </div>
  );
}

// ─── Plantilla de Slides ─────────────────────────────────────

function SlidesSection({ event, schema, regs, jobs, onEventPatch, onReload }: {
  event: EventRow; schema: FormSchema | null; regs: Registration[]; jobs: InvitationJob[];
  onEventPatch: Props['onEventPatch']; onReload: () => Promise<void>;
}) {
  const saved = slidesConfig(event.invitation_config);
  const [folderUrl, setFolderUrl] = useState(saved?.event_folder_url ?? '');
  const [inspecting, setInspecting] = useState(false);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [error, setError] = useState<{ message: string; email?: string } | null>(null);
  const [map, setMap] = useState<Record<string, PlaceholderMapping>>(saved?.placeholder_map ?? {});
  const [fileName, setFileName] = useState(saved?.file_name_template ?? '{{nombre}}');
  const [outputName, setOutputName] = useState(saved?.output_folder_name ?? 'Invitaciones');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string>('');
  const questions = (schema?.questions ?? []).filter(q => q.type !== 'statement');
  const lang = event.default_language;

  const placeholders = result?.template.placeholders ?? saved?.placeholders ?? [];
  const qrShapes = result?.template.qr_shapes ?? saved?.qr_shapes ?? 0;
  const templateName = result?.template.name ?? saved?.template_name;
  const templateUrl = result?.template.url ?? saved?.template_url;

  async function inspect() {
    setInspecting(true); setError(null); setResult(null);
    const res = await inspectInvitationTemplate(folderUrl);
    setInspecting(false);
    if (!res.ok) { setError({ message: res.message, email: res.service_account_email }); return; }
    setResult(res);
    // Conserva lo ya mapeado; sugiere lo nuevo
    setMap(prev => {
      const next: Record<string, PlaceholderMapping> = {};
      for (const ph of res.template.placeholders) next[ph] = prev[ph] ?? res.suggested_map[ph] ?? { source: 'literal', value: '' };
      return next;
    });
  }

  async function save() {
    const base = result ?? null;
    if (!base && !saved) return;
    setSaving(true);
    const cfg: InvitationConfig = {
      event_folder_id: base?.folder.id ?? saved!.event_folder_id,
      event_folder_url: base?.folder.url ?? saved!.event_folder_url,
      template_id: base?.template.id ?? saved!.template_id,
      template_url: base?.template.url ?? saved!.template_url,
      template_name: base?.template.name ?? saved!.template_name,
      output_folder_name: outputName.trim() || 'Invitaciones',
      placeholder_map: map,
      file_name_template: fileName.trim() || '{{nombre}}',
      placeholders: base?.template.placeholders ?? saved!.placeholders,
      qr_shapes: base?.template.qr_shapes ?? saved!.qr_shapes,
      generic: genericSettings(event.invitation_config),
    };
    await onEventPatch({ invitation_config: cfg }, 'Plantilla de invitación guardada');
    setSaving(false);
  }

  async function generateAll(force: boolean) {
    if (!saved) return;
    const targets = regs.filter(r => force || !r.invitation_url);
    if (targets.length === 0) return alert('Todos ya tienen invitación.');
    if (!confirm(`Se generarán ${targets.length} PDF en Drive${force ? ' (regenerando los existentes)' : ''}. ¿Continuar?`)) return;
    setRunning('Preparando…');
    try {
      const missingQr = targets.filter(r => !r.qr_url).map(r => r.id);
      if (missingQr.length) { setRunning(`QR ${missingQr.length}…`); await generateQrs(event.id, { ids: missingQr }); }
      const { data: job, error: jErr } = await supabase.from('invitation_jobs').insert({
        event_id: event.id, name: `${targets.length} invitaciones · ${new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`,
        config: saved, registration_ids: targets.map(r => r.id), force, total_rows: targets.length,
      }).select('id').single();
      if (jErr) throw new Error(jErr.message);
      let done = 0;
      for (let i = 0; i < 1000; i++) {
        setRunning(`PDF ${done}/${targets.length}`);
        const res = await runInvitationBatch(job.id);
        if (!res.ok) { if (res.retryable) { await new Promise(r => setTimeout(r, 4000)); continue; } throw new Error(res.message); }
        done += res.processed;
        if (res.completed) break;
      }
      setRunning('');
      await onReload();
    } catch (e) { setRunning(''); alert((e as Error).message); await onReload(); }
  }

  const withPdf = regs.filter(r => r.invitation_url).length;

  return (
    <div className="section-card">
      <h3>Invitación en PDF desde Google Slides</h3>
      <p className="section-hint">
        Igual que el rotulado: una carpeta de Drive compartida con la cuenta de servicio, dentro una sola presentación con marcadores <code>{'{{nombre}}'}</code>, <code>{'{{pases}}'}</code>… y una forma con texto o texto alternativo <code>{'{{qr}}'}</code> donde va el código.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="input-group" style={{ flex: 1, minWidth: 260 }}>
          <label className="input-label">Carpeta del evento en Drive</label>
          <input className="input-field" value={folderUrl} onChange={e => setFolderUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={inspect} disabled={inspecting || !folderUrl.trim()}>{inspecting ? 'Revisando…' : saved ? 'Volver a revisar' : 'Revisar carpeta'}</button>
      </div>

      {error && (
        <div className="inline-alert error" style={{ marginTop: 12 }}>
          {error.message}{error.email && <div className="text-xs" style={{ marginTop: 4 }}>Cuenta de servicio: <code>{error.email}</code></div>}
        </div>
      )}
      {result?.warnings.map((w, i) => <div key={i} className="inline-alert info" style={{ marginTop: 8 }}>⚠️ {w}</div>)}

      {templateName && (
        <>
          <div className="text-sm" style={{ marginTop: 14 }}>
            Plantilla: <a href={templateUrl} target="_blank" rel="noopener noreferrer"><b>{templateName}</b> ↗</a> · {placeholders.length} marcadores · {qrShapes} forma{qrShapes === 1 ? '' : 's'} para QR
          </div>

          <div className="editor-section">
            <h4>Marcadores</h4>
            <p className="section-hint">Qué dato va en cada uno.</p>
            {placeholders.map(ph => {
              const m = map[ph] ?? { source: 'literal', value: '' };
              return (
                <div key={ph} className="rule-row">
                  <code style={{ minWidth: 140 }}>{ph}</code>
                  <select className="glass-select" value={m.source} onChange={e => setMap({ ...map, [ph]: { source: e.target.value as PlaceholderMapping['source'], field: FIELD_OPTIONS[0].key, questionId: questions[0]?.id, value: '' } })}>
                    <option value="field">Dato del registro</option>
                    <option value="question">Respuesta a pregunta</option>
                    <option value="literal">Texto fijo</option>
                    <option value="qr">URL del QR</option>
                    <option value="empty">Vacío</option>
                  </select>
                  {m.source === 'field' && (
                    <select className="glass-select" value={m.field ?? ''} onChange={e => setMap({ ...map, [ph]: { ...m, field: e.target.value } })}>
                      {FIELD_OPTIONS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  )}
                  {m.source === 'question' && (
                    <select className="glass-select" value={m.questionId ?? ''} onChange={e => setMap({ ...map, [ph]: { ...m, questionId: e.target.value } })}>
                      {questions.map(q => <option key={q.id} value={q.id}>{text(q.title, lang) || q.id}</option>)}
                    </select>
                  )}
                  {m.source === 'literal' && (
                    <input className="input-field" value={m.value ?? ''} onChange={e => setMap({ ...map, [ph]: { ...m, value: e.target.value } })} placeholder="texto" />
                  )}
                </div>
              );
            })}
            <div className="field-grid" style={{ marginTop: 12 }}>
              <div className="input-group">
                <label className="input-label">Nombre del archivo</label>
                <input className="input-field" value={fileName} onChange={e => setFileName(e.target.value)} placeholder="{{nombre}}" />
                <div className="text-muted text-xs">Se le agrega un sufijo único. Variables: {'{{nombre}}, {{personas}}, {{evento}}'}…</div>
              </div>
              <div className="input-group">
                <label className="input-label">Subcarpeta de salida</label>
                <input className="input-field" value={outputName} onChange={e => setOutputName(e.target.value)} placeholder="Invitaciones" />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar plantilla'}</button>
            </div>
          </div>
        </>
      )}

      {saved && (
        <div className="editor-section">
          <h4>Generar</h4>
          <p className="section-hint">{withPdf} de {regs.length} registros ya tienen PDF. Para un subconjunto, selecciónalos en Registros y usa "Invitación" en la barra.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => generateAll(false)} disabled={!!running}>{running || `Generar los ${regs.length - withPdf} que faltan`}</button>
            <button className="btn btn-ghost btn-xs" onClick={() => generateAll(true)} disabled={!!running}>Regenerar todos</button>
          </div>

          {jobs.length > 0 && (
            <div className="data-table-wrapper" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead><tr><th>Corrida</th><th>Estado</th><th>Progreso</th><th>Errores</th><th>Carpeta</th></tr></thead>
                <tbody>
                  {jobs.map(j => (
                    <tr key={j.id}>
                      <td>{j.name}</td>
                      <td><span className={`badge ${JOB_STATUS_BADGE[j.status]}`}>{JOB_STATUS_LABEL[j.status]}</span></td>
                      <td>{j.processed_rows} / {j.total_rows}</td>
                      <td style={{ color: j.failed_rows ? 'var(--color-error)' : 'var(--text-muted)' }}>
                        {j.failed_rows || '—'}
                        {j.row_errors?.slice(0, 3).map((e, i) => <div key={i} className="text-xs">{e.name}: {e.message}</div>)}
                      </td>
                      <td>{j.output_folder_url ? <a href={j.output_folder_url} target="_blank" rel="noopener noreferrer">Drive ↗</a> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Excel ───────────────────────────────────────────────────

function ExcelSection({ ctx }: { ctx: BulkContext }) {
  const [open, setOpen] = useState(false);
  const withPhone = ctx.filtered.filter(r => r.phone).length;
  return (
    <div className="section-card">
      <h3>Excel para We Bot (WhatsApp)</h3>
      <p className="section-hint">Descarga el archivo con las columnas que el bot reconoce (Nombre, Telefono, N.boletos, Confirmados, Invitación, ConfirmationLink) y las preguntas que quieras como variables. Queda registrado en el historial de Comunicaciones.</p>
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)} disabled={withPhone === 0}>Exportar todos los activos ({withPhone} con teléfono)</button>
      <p className="text-muted text-xs" style={{ marginTop: 8 }}>Para un subconjunto, selecciónalos en Registros y usa "Excel WhatsApp" en la barra.</p>
      {open && <ExcelModal ctx={ctx} rows={ctx.filtered} onClose={() => setOpen(false)} />}
    </div>
  );
}
