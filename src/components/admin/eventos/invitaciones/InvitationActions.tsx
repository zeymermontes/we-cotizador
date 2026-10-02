import { useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../hooks/useAuth';
import type { BulkContext } from '../registros/RegistrationsPanel';
import {
  generateQrs, buildBotExcelName, buildBotRows, downloadBotExcel, logWhatsappExport,
  generateGenericInvitations, genericSettings, slidesConfig, runCloudInvitations,
} from '../../../../lib/invitations';
import { text } from '../../../../lib/form-types';

/** Acciones de la barra de selección reservadas al equipo: QR, invitación PDF y Excel WhatsApp. */
export default function InvitationActions({ ctx }: { ctx: BulkContext }) {
  const { isSuper } = useAuth();
  const [busy, setBusy] = useState<'' | 'qr' | 'img' | 'xlsx'>('');
  const [progress, setProgress] = useState('');
  const [excelOpen, setExcelOpen] = useState(false);
  if (!isSuper) return null;

  const ids = ctx.selected.map(r => r.id);
  const cloud = !!slidesConfig(ctx.event.invitation_config);

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
    if (cloud) {
      try {
        const res = await runCloudInvitations(ctx.event, targets, force, p => setProgress(p.status === 'qr' ? 'QR…' : `Nube ${p.done + p.failed}/${p.total - p.skipped}`));
        await ctx.refresh();
        alert(`Invitaciones generadas en la nube: ${res.done}${res.failed ? ` · fallidas: ${res.failed} (detalle en la pestaña Invitaciones)` : ''}${res.skipped ? `\nOmitidas: ${res.skipped} (cancelados)` : ''}${res.status === 'failed' ? `\nLa corrida falló: ${res.job?.last_error ?? ''}` : ''}`);
      } catch (e) { alert((e as Error).message); }
      setBusy(''); setProgress('');
      return;
    }
    try {
      const res = await generateGenericInvitations(ctx.event, targets, genericSettings(ctx.event.invitation_config), ctx.event.default_language, p => setProgress(`Invitación ${p.done + p.failed + p.skipped}/${p.total}${p.current ? ` · ${p.current}` : ''}`));
      await ctx.refresh();
      alert(`Invitaciones generadas: ${res.done}${res.failed ? ` · fallidas: ${res.failed}` : ''}${res.skipped ? `\nOmitidas: ${res.skipped} (cancelados sin QR; una invitación sin código no sirve para entrar)` : ''}${res.drive_error ? `\nCopia a Drive pendiente: ${res.drive_error}` : ''}`);
    } catch (e) { alert((e as Error).message); }
    setBusy(''); setProgress('');
  }

  return (
    <>
      <button className="btn btn-secondary btn-xs" onClick={qr} disabled={!!busy}>{busy === 'qr' ? progress : '▦ QR'}</button>
      <button className="btn btn-secondary btn-xs" onClick={img} disabled={!!busy}>{busy === 'img' ? progress : '🖼 Invitación'}</button>
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
