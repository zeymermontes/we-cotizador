import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { EventRow, EventLanguage } from '../../../lib/events-types';
import { LANGUAGE_LABEL } from '../../../lib/events-types';
import { slidesConfig } from '../../../lib/invitations';
import { RSVP_DEFAULTS, type RsvpConfig } from '../../../lib/rsvp';
import type { Automation, AutomationTrigger, MessageTemplate } from '../../../lib/messaging';

interface Props {
  event: EventRow;
  canEdit: boolean;
  onPatch: (fields: Partial<EventRow>, okText?: string) => Promise<boolean>;
}

type TextKey = 'question' | 'yes_label' | 'no_label' | 'message_yes' | 'message_no';
const FIELDS: { key: TextKey; label: string; def: 'question' | 'yes' | 'no' | 'message_yes' | 'message_no'; multiline?: boolean }[] = [
  { key: 'question', label: 'Pregunta', def: 'question' },
  { key: 'yes_label', label: 'Botón "sí"', def: 'yes' },
  { key: 'no_label', label: 'Botón "no"', def: 'no' },
  { key: 'message_yes', label: 'Mensaje si asistirá', def: 'message_yes', multiline: true },
  { key: 'message_no', label: 'Mensaje si no asistirá', def: 'message_no', multiline: true },
];

/** Ajustes → Lista VIP: textos de la página de confirmación y automatismos. */
export default function RsvpSettings({ event, canEdit, onPatch }: Props) {
  const [cfg, setCfg] = useState<RsvpConfig>((event.rsvp_config as RsvpConfig | null) ?? {});
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [autos, setAutos] = useState<Partial<Record<AutomationTrigger, Automation>>>({});
  const [busy, setBusy] = useState('');
  const langs = event.languages;
  const slides = slidesConfig(event.invitation_config);

  useEffect(() => {
    Promise.all([
      supabase.from('message_templates').select('*').eq('event_id', event.id).eq('channel', 'email').order('name'),
      supabase.from('automations').select('*').eq('event_id', event.id),
    ]).then(([t, a]) => {
      setTemplates((t.data as MessageTemplate[]) ?? []);
      const map: Partial<Record<AutomationTrigger, Automation>> = {};
      for (const row of (a.data as Automation[]) ?? []) map[row.trigger] = row;
      setAutos(map);
    });
  }, [event.id]);

  const setText = (key: TextKey, lang: EventLanguage, value: string) => setCfg(c => ({ ...c, [key]: { ...(c[key] ?? {}), [lang]: value } }));

  async function save() {
    setSaving(true);
    await onPatch({ rsvp_config: cfg }, 'Confirmación VIP guardada');
    setSaving(false);
  }

  async function upsertAuto(trigger: AutomationTrigger, patch: Partial<Automation>) {
    setBusy(trigger);
    const cur = autos[trigger];
    const next = { event_id: event.id, trigger, channel: 'email' as const, template_id: cur?.template_id ?? null, enabled: cur?.enabled ?? false, days_before: cur?.days_before ?? 1, ...patch };
    const { data, error } = await supabase.from('automations').upsert(next, { onConflict: 'event_id,trigger' }).select('*').single();
    setBusy('');
    if (error) return alert(error.message);
    setAutos(a => ({ ...a, [trigger]: data as Automation }));
  }

  const autoRow = (trigger: AutomationTrigger, label: string, hint: string, needle: string) => {
    const a = autos[trigger];
    const tpl = templates.find(t => t.id === a?.template_id);
    const lacks = tpl && needle && !Object.values(tpl.body ?? {}).some(b => (b ?? '').includes(needle));
    return (
      <div className="switch-row" key={trigger}>
        <div>
          {label}<small>{hint}</small>
          {lacks && <small style={{ color: 'var(--color-warning, #b45309)' }}>La plantilla elegida no incluye <code>{needle}</code>.</small>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="glass-select" value={a?.template_id ?? ''} disabled={!canEdit || busy === trigger} onChange={e => upsertAuto(trigger, { template_id: e.target.value || null })}>
            <option value="">Elige plantilla…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="checkbox" checked={!!a?.enabled} disabled={!canEdit || !a?.template_id || busy === trigger} onChange={e => upsertAuto(trigger, { enabled: e.target.checked })} />
        </div>
      </div>
    );
  };

  return (
    <div className="section-card">
      <h3>Lista VIP y confirmación por enlace</h3>
      <p className="section-hint">
        Invitados que agrega el equipo (Registros → "+ VIP") y confirman con un enlace personal, sin llenar el formulario. La página muestra la portada del evento, la pregunta y dos botones. Variable para las plantillas: <code>{'{{confirmacion_url}}'}</code>.
      </p>

      <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {FIELDS.map(f => (
          <div key={f.key} className="input-group" style={f.multiline ? { gridColumn: '1 / -1' } : undefined}>
            <label className="input-label">{f.label}</label>
            {langs.map(l => (
              <div key={l} className="lang-input">
                {langs.length > 1 && <span className="lang-tag">{LANGUAGE_LABEL[l]}</span>}
                {f.multiline ? (
                  <textarea className="input-field" rows={2} style={{ fontSize: 'var(--text-sm)' }} value={cfg[f.key]?.[l] ?? ''} placeholder={RSVP_DEFAULTS[l === 'en' ? 'en' : 'es'][f.def]} disabled={!canEdit} onChange={e => setText(f.key, l, e.target.value)} />
                ) : (
                  <input className="input-field" style={{ padding: '8px 0' }} value={cfg[f.key]?.[l] ?? ''} placeholder={RSVP_DEFAULTS[l === 'en' ? 'en' : 'es'][f.def]} disabled={!canEdit} onChange={e => setText(f.key, l, e.target.value)} />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-muted text-xs" style={{ marginTop: 6 }}>Puedes usar <code>{'{{nombre}}'}</code>, <code>{'{{evento}}'}</code>, enlaces y <code>**negritas**</code>. Vacío = texto estándar.</p>

      <div className="switch-row" style={{ marginTop: 12 }}>
        <div>
          Generar QR e invitación al confirmar
          <small>{slides ? 'Con la plantilla de Drive del evento. El estatus pasa a "Confirmado" cuando la invitación está lista.' : 'Genera el QR; para la invitación crea antes la plantilla en Drive (pestaña Invitaciones).'}</small>
        </div>
        <input type="checkbox" checked={!!cfg.auto_invitation} disabled={!canEdit} onChange={e => setCfg(c => ({ ...c, auto_invitation: e.target.checked }))} />
      </div>

      {canEdit && (
        <div className="modal-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      )}

      <div className="editor-section">
        <h4>Envíos automáticos por correo</h4>
        <p className="section-hint">Las plantillas se crean en Comunicaciones. Por WhatsApp el enlace y la invitación salen con el Excel del bot (columnas ConfirmationLink e Invitación).</p>
        {autoRow('on_invited', 'Mandar el enlace de confirmación al agregar VIPs', 'Se dispara al pasar a "Invitado", que es como entran los VIP.', '{{confirmacion_url}}')}
        {autoRow('on_confirmed', 'Mandar la invitación al confirmar', 'Se dispara al pasar a "Confirmado". Marca "Adjuntar la invitación" o el QR en la plantilla.', '')}
      </div>
    </div>
  );
}
