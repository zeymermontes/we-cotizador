import { useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../hooks/useAuth';
import type { BulkContext } from '../registros/RegistrationsPanel';
import {
  generateQrs, buildBotExcelName, buildBotRows, downloadBotExcel, logWhatsappExport,
  runInvitationBatch, type InvitationConfig, generateGenericInvitations, genericSettings,
} from '../../../../lib/invitations';
import { text } from '../../../../lib/form-types';

/** Acciones de la barra de selección reservadas al equipo: QR, invitación PDF y Excel WhatsApp. */
export default function InvitationActions({ ctx }: { ctx: BulkContext }) {
  const { isSuper, session } = useAuth();
  const [busy, setBusy] = useState<'' | 'qr' | 'pdf' | 'img' | 'xlsx'>('');
  const [progress, setProgress] = useState('');
  const [excelOpen, setExcelOpen] = useState(false);
  if (!isSuper) return null;

  const ids = ctx.selected.map(r => r.id);
  const cfg = ctx.event.invitation_config as InvitationConfig | null;

  async function qr() {
    setBusy('qr'); setProgress('QR…');
    try {
      const p = await generateQrs(ctx.event.id, { ids }, s => setProgress(`QR ${s.done}${s.remaining ? ` (faltan ${s.remaining})` : ''}`));
      await ctx.refresh();
      alert(`QR generados: ${p.done}${p.failed ? ` · fallidos: ${p.failed}` : ''}`);
    } catch (e) { alert((e as Error).message); }
    setBusy(''); setProgress('');
  }

  async function img() {
    const force = ctx.selected.some(r => r.invitation_url) && confirm('Algunos ya tienen invitación. ¿Regenerarlas? (Cancelar = solo los que no tienen)');
    const targets = ctx.selected.filter(r => force || !r.invitation_url);
    if (targets.length === 0) return alert('Todos los seleccionados ya tienen invitación.');
    setBusy('img');
    try {
      const res = await generateGenericInvitations(ctx.event, targets, genericSettings(ctx.event.invitation_config), ctx.event.default_language, p => setProgress(`Invitación ${p.done + p.failed}/${p.total}${p.current ? ` · ${p.current}` : ''}`));
      await ctx.refresh();
      alert(`Invitaciones generadas: ${res.done}${res.failed ? ` · fallidas: ${res.failed}` : ''}${res.drive_error ? `\nCopia a Drive pendiente: ${res.drive_error}` : ''}`);
    } catch (e) { alert((e as Error).message); }
    setBusy(''); setProgress('');
  }

  async function pdf() {
    if (!cfg?.template_id) return alert('Primero configura la plantilla de Slides en la pestaña Invitaciones.');
    const withoutQr = ctx.selected.filter(r => !r.qr_url).length;
    if (withoutQr && !confirm(`${withoutQr} de los seleccionados no tienen QR todavía. ¿Generar los QR primero y luego las invitaciones?`)) return;
    setBusy('pdf');
    try {
      if (withoutQr) {
        setProgress('QR…');
        await generateQrs(ctx.event.id, { ids });
      }
      const force = ctx.selected.some(r => r.invitation_url) && confirm('Algunos ya tienen invitación. ¿Regenerarlas? (Cancelar = solo los que no tienen)');
      const { data: job, error } = await supabase.from('invitation_jobs').insert({
        event_id: ctx.event.id,
        name: `${ids.length} invitaciones · ${new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`,
        config: cfg,
        registration_ids: ids,
        force,
        total_rows: ids.length,
        created_by: session?.user.id ?? null,
      }).select('id').single();
      if (error) throw new Error(error.message);
      let done = 0;
      for (let i = 0; i < 500; i++) {
        setProgress(`PDF ${done}/${ids.length}`);
        const res = await runInvitationBatch(job.id);
        if (!res.ok) {
          if (res.retryable) { await new Promise(r => setTimeout(r, 4000)); continue; }
          throw new Error(res.message);
        }
        done += res.processed;
        if (res.completed) break;
      }
      await ctx.refresh();
      alert(`Invitaciones generadas: ${done}. Revisa la pestaña Invitaciones para ver errores y la carpeta de Drive.`);
    } catch (e) { alert((e as Error).message); }
    setBusy(''); setProgress('');
  }

  return (
    <>
      <button className="btn btn-secondary btn-xs" onClick={qr} disabled={!!busy}>{busy === 'qr' ? progress : '▦ QR'}</button>
      <button className="btn btn-secondary btn-xs" onClick={img} disabled={!!busy}>{busy === 'img' ? progress : '🖼 Invitación'}</button>
      {cfg?.template_id && <button className="btn btn-secondary btn-xs" onClick={pdf} disabled={!!busy}>{busy === 'pdf' ? progress : '📄 PDF Slides'}</button>}
      <button className="btn btn-secondary btn-xs" onClick={() => setExcelOpen(true)} disabled={!!busy}>💬 Excel WhatsApp</button>
      {excelOpen && <ExcelModal ctx={ctx} onClose={() => setExcelOpen(false)} />}
    </>
  );
}

export function ExcelModal({ ctx, onClose, rows }: { ctx: BulkContext; onClose: () => void; rows?: BulkContext['selected'] }) {
  const regs = rows ?? ctx.selected;
  const lang = ctx.event.default_language;
  const questions = (ctx.schema?.questions ?? []).filter(q => q.type !== 'statement' && !q.identity);
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [includeEmail, setIncludeEmail] = useState(false);
  const [includeQr, setIncludeQr] = useState(false);
  const [markInvited, setMarkInvited] = useState(true);
  const [busy, setBusy] = useState(false);
  const withPhone = regs.filter(r => r.phone);
  const withoutPdf = withPhone.filter(r => !r.invitation_url).length;

  async function download() {
    setBusy(true);
    const data = buildBotRows(withPhone, ctx.schema, lang, { questionIds, includeEmail, includeQr });
    downloadBotExcel(buildBotExcelName(ctx.event.slug), data);
    await logWhatsappExport(ctx.event.id, withPhone);
    if (markInvited) {
      const ids = withPhone.filter(r => ['registered', 'selected', 'waitlist'].includes(r.status)).map(r => r.id);
      if (ids.length) await supabase.from('registrations').update({ status: 'invited' }).in('id', ids);
    }
    await ctx.refresh();
    setBusy(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h2>Excel para We Bot</h2>
        <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
          <b>{regs.length}</b> registros, <b>{withPhone.length}</b> con teléfono (los demás se omiten).
          {withoutPdf > 0 && <> <b>{withoutPdf}</b> aún no tienen PDF de invitación: la columna "Invitación" irá vacía.</>}
        </p>
        <p className="text-muted text-xs" style={{ marginBottom: 12 }}>Columnas: Nombre · Telefono · N.boletos · Confirmados · Invitación · ConfirmationLink, más las que agregues aquí como variables.</p>
        {questions.length > 0 && (
          <div className="input-group">
            <label className="input-label">Preguntas como columnas extra</label>
            <div className="chip-row">
              {questions.map(q => (
                <button key={q.id} type="button" className={`chip ${questionIds.includes(q.id) ? 'active' : ''}`} onClick={() => setQuestionIds(s => (s.includes(q.id) ? s.filter(x => x !== q.id) : [...s, q.id]))}>
                  {text(q.title, lang) || q.id}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, fontSize: 'var(--text-sm)' }}>
          <label style={{ display: 'flex', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={includeEmail} onChange={e => setIncludeEmail(e.target.checked)} /> Incluir columna Correo</label>
          <label style={{ display: 'flex', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={includeQr} onChange={e => setIncludeQr(e.target.checked)} /> Incluir columna QR (URL de la imagen)</label>
          <label style={{ display: 'flex', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={markInvited} onChange={e => setMarkInvited(e.target.checked)} /> Marcar como "Invitado" a los exportados</label>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={download} disabled={busy || withPhone.length === 0}>{busy ? 'Generando…' : `Descargar Excel (${withPhone.length})`}</button>
        </div>
      </div>
    </div>
  );
}
