import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../hooks/useAuth';
import type { EventRow } from '../../../../lib/events-types';
import { type FormSchema, type Lang, type Localized, normalizeSchema } from '../../../../lib/form-types';
import {
  type MessageTemplate, type MessageRow, type Automation, type AutomationTrigger, type MessageStatus,
  MESSAGE_STATUS_LABEL, TRIGGER_INFO, TRIGGER_LABEL,
  variablesFor, buildVars, renderTemplate, textToHtml, emailHtml,
} from '../../../../lib/messaging';
import type { Registration } from '../../../../lib/registrations';
import { Switch } from '../builder/QuestionEditor';

type SubTab = 'plantillas' | 'automatizaciones' | 'historial' | 'remitente';

interface Props {
  event: EventRow;
  onEventPatch: (fields: Partial<EventRow>, okText?: string) => Promise<boolean>;
}

const LANG_TAG: Record<Lang, string> = { es: 'ES', en: 'EN' };

const STARTER: Record<Lang, { subject: string; body: string }> = {
  es: {
    subject: '¡Tu registro a {{evento}} quedó listo!',
    body: 'Hola {{primer_nombre}},\n\nGracias por registrarte a **{{evento}}**.\n\n📅 {{fecha}} · {{hora}}\n📍 {{lugar}}\n\nTe escribiremos con los siguientes pasos.\n\nNos vemos pronto.',
  },
  en: {
    subject: 'You are registered for {{evento}}!',
    body: 'Hi {{primer_nombre}},\n\nThanks for registering for **{{evento}}**.\n\n📅 {{fecha}} · {{hora}}\n📍 {{lugar}}\n\nWe will be in touch with next steps.\n\nSee you soon.',
  },
};

export default function CommunicationsPanel({ event, onEventPatch }: Props) {
  const [tab, setTab] = useState<SubTab>('plantillas');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [sample, setSample] = useState<Registration | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: tpls }, { data: form }, { data: reg }] = await Promise.all([
      supabase.from('message_templates').select('*').eq('event_id', event.id).order('created_at'),
      supabase.from('event_forms').select('draft, published_version').eq('event_id', event.id).maybeSingle(),
      supabase.from('registrations').select('*').eq('event_id', event.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    setTemplates((tpls as MessageTemplate[]) ?? []);
    setSample((reg as Registration | null) ?? null);
    if (form?.published_version) {
      const { data: v } = await supabase.from('form_versions').select('schema').eq('event_id', event.id).eq('version', form.published_version).maybeSingle();
      setSchema(normalizeSchema(v?.schema ?? form.draft));
    } else setSchema(form ? normalizeSchema(form.draft) : null);
    setLoading(false);
  }, [event.id]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Cargando…</div>;

  return (
    <div>
      <div className="subtabs">
        {([['plantillas', 'Plantillas'], ['automatizaciones', 'Automatizaciones'], ['historial', 'Historial'], ['remitente', 'Remitente']] as [SubTab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'plantillas' && <Templates event={event} templates={templates} schema={schema} sample={sample} onChanged={setTemplates} />}
      {tab === 'automatizaciones' && <Automations event={event} templates={templates} />}
      {tab === 'historial' && <History event={event} templates={templates} />}
      {tab === 'remitente' && <Sender event={event} onEventPatch={onEventPatch} />}
    </div>
  );
}

// ─── Plantillas ──────────────────────────────────────────────

function Templates({ event, templates, schema, sample, onChanged }: {
  event: EventRow; templates: MessageTemplate[]; schema: FormSchema | null; sample: Registration | null;
  onChanged: (t: MessageTemplate[]) => void;
}) {
  const { session } = useAuth();
  const langs: Lang[] = event.languages;
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id ?? '');
  const [draft, setDraft] = useState<MessageTemplate | null>(templates[0] ?? null);
  const [previewLang, setPreviewLang] = useState<Lang>(event.default_language);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [flash, setFlash] = useState('');
  const bodyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const lastFocused = useRef<{ field: 'subject' | 'body'; lang: Lang }>({ field: 'body', lang: langs[0] });

  const saved = templates.find(t => t.id === selectedId) ?? null;
  const dirty = draft && saved ? JSON.stringify({ n: draft.name, s: draft.subject, b: draft.body }) !== JSON.stringify({ n: saved.name, s: saved.subject, b: saved.body }) : false;
  const vars = useMemo(() => variablesFor(schema, langs[0]), [schema, langs]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  function select(t: MessageTemplate) {
    if (dirty && !confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
    setSelectedId(t.id); setDraft(t);
  }

  async function create() {
    const subject: Localized = {}; const body: Localized = {};
    for (const l of langs) { subject[l] = STARTER[l].subject; body[l] = STARTER[l].body; }
    const { data, error } = await supabase.from('message_templates')
      .insert({ event_id: event.id, channel: 'email', name: `Plantilla ${templates.length + 1}`, subject, body, created_by: session?.user.id ?? null })
      .select('*').single();
    if (error) return alert(error.message);
    const t = data as MessageTemplate;
    onChanged([...templates, t]); setSelectedId(t.id); setDraft(t);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    const { error } = await supabase.from('message_templates').update({ name: draft.name, subject: draft.subject, body: draft.body }).eq('id', draft.id);
    setSaving(false);
    if (error) return alert(error.message);
    onChanged(templates.map(t => (t.id === draft.id ? { ...t, name: draft.name, subject: draft.subject, body: draft.body } : t)));
    setFlash('Plantilla guardada');
  }

  async function remove() {
    if (!draft || !confirm(`¿Eliminar la plantilla "${draft.name}"?`)) return;
    await supabase.from('message_templates').delete().eq('id', draft.id);
    const rest = templates.filter(t => t.id !== draft.id);
    onChanged(rest); setSelectedId(rest[0]?.id ?? ''); setDraft(rest[0] ?? null);
  }

  async function sendTest() {
    if (!draft || !session?.user.email) return;
    if (dirty) await save();
    setTesting(true);
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; sent?: number; message?: string; errors?: { message: string }[] }>('send-messages', {
      body: { event_id: event.id, template_id: draft.id, registration_ids: sample ? [sample.id] : [], test_to: session.user.email },
    });
    setTesting(false);
    if (error || !data?.ok) return alert(data?.message || error?.message || 'No se pudo enviar');
    if (data.sent) setFlash(`Prueba enviada a ${session.user.email}`);
    else alert(data.errors?.[0]?.message ?? 'No se envió. Revisa RESEND_API_KEY y el dominio.');
  }

  function insertVar(key: string) {
    if (!draft) return;
    const { field, lang } = lastFocused.current;
    const token = `{{${key}}}`;
    if (field === 'body') {
      const el = bodyRefs.current[lang];
      const cur = draft.body[lang] ?? '';
      const pos = el?.selectionStart ?? cur.length;
      const next = cur.slice(0, pos) + token + cur.slice(pos);
      setDraft({ ...draft, body: { ...draft.body, [lang]: next } });
      setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + token.length, pos + token.length); }, 0);
    } else {
      setDraft({ ...draft, subject: { ...draft.subject, [lang]: (draft.subject[lang] ?? '') + token } });
    }
  }

  const previewHtml = useMemo(() => {
    if (!draft) return '';
    const r = sample ?? { name: 'Ana Ejemplo', email: 'ana@ejemplo.com', phone: '+52 33 1234 5678', party_size: 2, company: 'We.Page', lang: previewLang, answers: {} };
    const v = buildVars(event, r, schema, previewLang);
    const body = renderTemplate(draft.body[previewLang] ?? '', v);
    return emailHtml(textToHtml(body), { logoUrl: event.branding.logo_url, primary: event.branding.primary, background: event.branding.background, surface: event.branding.surface, textColor: event.branding.text, eventName: event.name });
  }, [draft, sample, schema, previewLang, event]);

  const previewSubject = draft ? renderTemplate(draft.subject[previewLang] ?? '', buildVars(event, sample ?? { name: 'Ana Ejemplo', email: '', phone: '', party_size: 2, company: '', lang: previewLang, answers: {} }, schema, previewLang)) : '';

  return (
    <div className="tpl-layout">
      <div className="tpl-list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px 8px' }}>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>CORREOS</span>
          <button className="btn btn-primary btn-xs" onClick={create}>+ Nueva</button>
        </div>
        {templates.length === 0 && <p className="text-muted text-sm" style={{ padding: 6 }}>Crea tu primera plantilla.</p>}
        {templates.map(t => (
          <div key={t.id} className={`tpl-item ${t.id === selectedId ? 'active' : ''}`} onClick={() => select(t)}>
            {t.name}
            <small>{t.subject[langs[0]] || 'Sin asunto'}</small>
          </div>
        ))}
      </div>

      {draft ? (
        <div className="section-card" style={{ marginBottom: 0 }}>
          {flash && <div className="inline-alert success">{flash}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input className="input-field" style={{ flex: 1, minWidth: 180, fontWeight: 600 }} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Nombre interno" />
            <button className="btn btn-ghost btn-xs" onClick={remove}>Eliminar</button>
            <button className="btn btn-secondary btn-xs" onClick={sendTest} disabled={testing}>{testing ? 'Enviando…' : `Prueba a ${session?.user.email ?? 'mi correo'}`}</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>{saving ? 'Guardando…' : dirty ? 'Guardar' : 'Guardado ✓'}</button>
          </div>

          <div className="input-group">
            <label className="input-label">Variables (clic para insertar donde esté el cursor)</label>
            <div className="var-chips">
              {vars.map(v => <button key={v.key} type="button" className="var-chip" title={v.hint ?? v.label} onClick={() => insertVar(v.key)}>{v.label}</button>)}
            </div>
          </div>

          <div className="field-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <div>
              {langs.map(l => (
                <div key={l} style={{ marginBottom: 14 }}>
                  {langs.length > 1 && <div className="palette-group" style={{ margin: '0 0 4px' }}>{LANG_TAG[l]}</div>}
                  <div className="input-group">
                    <label className="input-label">Asunto</label>
                    <input className="input-field" style={{ padding: '8px 0', fontSize: 'var(--text-base)' }} value={draft.subject[l] ?? ''} onFocus={() => { lastFocused.current = { field: 'subject', lang: l }; }} onChange={e => setDraft({ ...draft, subject: { ...draft.subject, [l]: e.target.value } })} />
                  </div>
                  <div className="input-group" style={{ marginTop: 8 }}>
                    <label className="input-label">Mensaje <span className="text-muted">(línea en blanco = párrafo, **negritas**, [texto](url))</span></label>
                    <textarea ref={el => { bodyRefs.current[l] = el; }} className="tpl-body" value={draft.body[l] ?? ''} onFocus={() => { lastFocused.current = { field: 'body', lang: l }; }} onChange={e => setDraft({ ...draft, body: { ...draft.body, [l]: e.target.value } })} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label className="input-label" style={{ flex: 1 }}>Vista previa {sample ? `con ${sample.name ?? 'el último registro'}` : 'con datos de ejemplo'}</label>
                {langs.length > 1 && (
                  <div className="segmented">{langs.map(l => <button key={l} type="button" className={previewLang === l ? 'active' : ''} onClick={() => setPreviewLang(l)}>{LANG_TAG[l]}</button>)}</div>
                )}
              </div>
              <div className="text-sm" style={{ marginBottom: 6 }}><b>Asunto:</b> {previewSubject || <span className="text-muted">vacío</span>}</div>
              <div className="email-preview"><iframe title="preview" srcDoc={previewHtml} sandbox="" /></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="section-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Selecciona o crea una plantilla.</div>
      )}
    </div>
  );
}

// ─── Automatizaciones ────────────────────────────────────────

function Automations({ event, templates }: { event: EventRow; templates: MessageTemplate[] }) {
  const [rows, setRows] = useState<Record<AutomationTrigger, Automation | null>>({ on_register: null, on_waitlist: null, on_selected: null, on_invited: null, on_confirmed: null, reminder: null });
  const [busy, setBusy] = useState<string>('');

  useEffect(() => {
    supabase.from('automations').select('*').eq('event_id', event.id).then(({ data }) => {
      const map = { on_register: null, on_waitlist: null, on_selected: null, on_invited: null, on_confirmed: null, reminder: null } as Record<AutomationTrigger, Automation | null>;
      for (const a of (data as Automation[]) ?? []) map[a.trigger] = a;
      setRows(map);
    });
  }, [event.id]);

  async function upsert(trigger: AutomationTrigger, patch: Partial<Automation>) {
    setBusy(trigger);
    const cur = rows[trigger];
    const next = { event_id: event.id, trigger, channel: 'email' as const, template_id: cur?.template_id ?? null, enabled: cur?.enabled ?? false, days_before: cur?.days_before ?? 1, ...patch };
    const { data, error } = await supabase.from('automations').upsert(next, { onConflict: 'event_id,trigger' }).select('*').single();
    setBusy('');
    if (error) return alert(error.message);
    setRows(r => ({ ...r, [trigger]: data as Automation }));
  }

  return (
    <div className="section-card">
      <h3>Automatizaciones</h3>
      <p className="section-hint">Cada disparador manda una plantilla por correo. Si lo apagas, el envío queda manual desde Registros.</p>
      {templates.length === 0 && <div className="inline-alert info">Primero crea una plantilla en la pestaña Plantillas.</div>}
      {TRIGGER_INFO.map(t => {
        const a = rows[t.key];
        const enabled = !!a?.enabled && !!a?.template_id;
        return (
          <div key={t.key} className="auto-row">
            <div>
              <div style={{ fontWeight: 500 }}>{t.label}</div>
              <div className="text-muted text-xs">{t.hint}</div>
            </div>
            <div className="auto-controls">
              {t.key === 'reminder' && (
                <select className="glass-select" value={a?.days_before ?? 1} disabled={busy === t.key} onChange={e => upsert(t.key, { days_before: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 5, 7, 14].map(d => <option key={d} value={d}>{d === 0 ? 'El mismo día' : `${d} día${d === 1 ? '' : 's'} antes`}</option>)}
                </select>
              )}
              <select className="glass-select" value={a?.template_id ?? ''} disabled={busy === t.key || templates.length === 0} onChange={e => upsert(t.key, { template_id: e.target.value || null })}>
                <option value="">Sin plantilla</option>
                {templates.map(tp => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
              </select>
              <Switch label="" checked={enabled} onChange={v => upsert(t.key, { enabled: v })} />
            </div>
          </div>
        );
      })}
      <p className="text-muted text-xs" style={{ marginTop: 12 }}>
        "Al registrarse" y "lista de espera" corren en el envío del formulario. Los demás disparadores y el recordatorio necesitan en Supabase Vault los secretos <code>functions_base_url</code> y <code>labeling_cron_key</code>.
      </p>
    </div>
  );
}

// ─── Historial ───────────────────────────────────────────────

function History({ event, templates }: { event: EventRow; templates: MessageTemplate[] }) {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [status, setStatus] = useState<'' | MessageStatus>('');
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase.from('messages').select('*').eq('event_id', event.id).order('created_at', { ascending: false }).limit(300);
    const list = (data as MessageRow[]) ?? [];
    setRows(list);
    const ids = Array.from(new Set(list.map(m => m.registration_id).filter((x): x is string => !!x)));
    if (ids.length) {
      const { data: regs } = await supabase.from('registrations').select('id, name').in('id', ids);
      setNames(Object.fromEntries(((regs ?? []) as { id: string; name: string | null }[]).map(r => [r.id, r.name ?? ''])));
    }
  }, [event.id]);

  useEffect(() => {
    (async () => { await load(); })();
    const ch = supabase.channel(`messages:${event.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `event_id=eq.${event.id}` }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [event.id, load]);

  const tplName = (id: string | null) => templates.find(t => t.id === id)?.name ?? '';
  const visible = status ? rows.filter(r => r.status === status) : rows;
  const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div>
      <div className="reg-toolbar">
        <select className="glass-select" value={status} onChange={e => setStatus(e.target.value as '' | MessageStatus)}>
          <option value="">Todos los estados ({rows.length})</option>
          {(Object.keys(MESSAGE_STATUS_LABEL) as MessageStatus[]).map(s => <option key={s} value={s}>{MESSAGE_STATUS_LABEL[s]} ({counts[s] ?? 0})</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-xs" onClick={load}>Actualizar</button>
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Origen</th><th>Estado</th></tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Sin mensajes todavía.</td></tr>}
            {visible.map(m => (
              <tr key={m.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{new Date(m.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>
                  <div style={{ fontWeight: 500 }}>{m.registration_id ? names[m.registration_id] || '—' : 'Prueba'}</div>
                  <div className="text-muted text-xs">{m.to_address}</div>
                </td>
                <td className="cell" title={m.subject ?? ''}>{m.subject}<div className="text-muted text-xs">{tplName(m.template_id)}</div></td>
                <td>{m.channel === 'whatsapp' ? '💬 ' : '✉️ '}{TRIGGER_LABEL[m.trigger ?? ''] ?? m.trigger}</td>
                <td>
                  <span className={`badge badge-${m.status}`}>{MESSAGE_STATUS_LABEL[m.status]}</span>
                  {m.error && <div className="text-xs" style={{ color: 'var(--color-error)' }}>{m.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Remitente ───────────────────────────────────────────────

function Sender({ event, onEventPatch }: { event: EventRow; onEventPatch: Props['onEventPatch'] }) {
  const [senderName, setSenderName] = useState(event.sender_name ?? '');
  const [replyTo, setReplyTo] = useState(event.reply_to ?? '');
  const [saving, setSaving] = useState(false);
  return (
    <form className="section-card" onSubmit={async e => { e.preventDefault(); setSaving(true); await onEventPatch({ sender_name: senderName.trim() || null, reply_to: replyTo.trim() || null }, 'Remitente guardado'); setSaving(false); }}>
      <h3>Remitente</h3>
      <p className="section-hint">Los correos salen desde <code>hola@eventos.we.page</code> con el nombre que pongas aquí. Las respuestas llegan al correo de respuesta.</p>
      <div className="field-grid">
        <div className="input-group"><label className="input-label">Nombre del remitente</label><input className="input-field" value={senderName} onChange={e => setSenderName(e.target.value)} placeholder={event.name} /></div>
        <div className="input-group"><label className="input-label">Correo de respuesta</label><input className="input-field" type="email" value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder="organizador@correo.com" /></div>
      </div>
      <div className="modal-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  );
}
