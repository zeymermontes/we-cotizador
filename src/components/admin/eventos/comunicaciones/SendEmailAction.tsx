import { useState, useEffect } from 'react';
import { supabase } from '../../../../lib/supabase';
import type { BulkContext } from '../registros/RegistrationsPanel';
import type { MessageTemplate } from '../../../../lib/messaging';

interface SendResult { ok: boolean; sent?: number; skipped?: number; failed?: number; message?: string; errors?: { message: string }[] }

/** Botón "Enviar correo" de la barra de selección + su modal. */
export default function SendEmailAction({ ctx }: { ctx: BulkContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-secondary btn-xs" onClick={() => setOpen(true)}>✉️ Enviar correo</button>
      {open && <SendEmailModal ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

function SendEmailModal({ ctx, onClose }: { ctx: BulkContext; onClose: () => void }) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [markInvited, setMarkInvited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const withEmail = ctx.selected.filter(r => r.email);

  useEffect(() => {
    supabase.from('message_templates').select('*').eq('event_id', ctx.event.id).eq('channel', 'email').order('created_at')
      .then(({ data }) => {
        const list = (data as MessageTemplate[]) ?? [];
        setTemplates(list);
        if (list[0]) setTemplateId(list[0].id);
      });
  }, [ctx.event.id]);

  async function send() {
    if (!templateId || withEmail.length === 0) return;
    if (!confirm(`¿Enviar "${templates.find(t => t.id === templateId)?.name}" a ${withEmail.length} persona(s)?`)) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke<SendResult>('send-messages', {
      body: { event_id: ctx.event.id, template_id: templateId, registration_ids: withEmail.map(r => r.id) },
    });
    if (error || !data?.ok) {
      setResult({ ok: false, message: data?.message || error?.message || 'No se pudo enviar' });
      setBusy(false);
      return;
    }
    if (markInvited) {
      await supabase.from('registrations').update({ status: 'invited' }).in('id', withEmail.map(r => r.id));
      await ctx.refresh();
    }
    setResult(data);
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h2>Enviar correo</h2>
        {result ? (
          <>
            {result.ok ? (
              <div className="inline-alert success">
                Enviados: <b>{result.sent}</b> · Sin correo: {result.skipped} · Fallidos: {result.failed}
              </div>
            ) : (
              <div className="inline-alert error">{result.message}</div>
            )}
            {result.errors && result.errors.length > 0 && (
              <ul className="issue-list">{result.errors.slice(0, 5).map((e, i) => <li key={i}>⛔ {e.message}</li>)}</ul>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary btn-sm" onClick={() => { ctx.clearSelection(); onClose(); }}>Listo</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
              <b>{ctx.selected.length}</b> seleccionados, <b>{withEmail.length}</b> con correo.
              {withEmail.length < ctx.selected.length && ' Los que no tienen correo se omiten.'}
            </p>
            {templates.length === 0 ? (
              <div className="inline-alert info">Aún no hay plantillas. Créalas en la pestaña Comunicaciones.</div>
            ) : (
              <div className="input-group">
                <label className="input-label">Plantilla</label>
                <select className="glass-select" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--text-sm)', marginTop: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={markInvited} onChange={e => setMarkInvited(e.target.checked)} />
              Marcar como "Invitado" después de enviar
            </label>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={send} disabled={busy || !templateId || withEmail.length === 0}>
                {busy ? 'Enviando…' : `Enviar a ${withEmail.length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
