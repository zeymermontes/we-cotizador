import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import type { EventRow, EventMember, MemberRole } from '../../../lib/events-types';
import { EVENT_TABS } from '../../../lib/events-types';

interface Props {
  event: EventRow;
  isSuper: boolean;
  onChanged: () => Promise<void>;
  onFlash: (f: { kind: 'success' | 'error'; text: string }) => void;
}

const ROLE_LABEL: Record<MemberRole, string> = { owner: 'Dueño', admin: 'Administrador', viewer: 'Solo lectura' };

interface InviteResult {
  ok: boolean;
  outcome?: 'created' | 'existing' | 'password_updated';
  email_sent?: boolean;
  email_error?: string | null;
  message?: string;
}

const OUTCOME_TEXT: Record<NonNullable<InviteResult['outcome']>, string> = {
  created: 'Usuario creado; le avisamos por correo. La contraseña se la compartes tú.',
  existing: 'Ya tenía cuenta: se le dio acceso sin tocar su contraseña y le avisamos por correo.',
  password_updated: 'Contraseña actualizada; le avisamos por correo.',
};

export default function MembersPanel({ event, isSuper, onFlash }: Props) {
  const [members, setMembers] = useState<EventMember[]>([]);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [resetPassword, setResetPassword] = useState(false);
  const [role, setRole] = useState<MemberRole>('admin');
  const [tabs, setTabs] = useState<string[]>(EVENT_TABS.map(t => t.key));
  const allTabs = EVENT_TABS.map(t => t.key);
  const toggleTab = (list: string[], key: string) => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    await supabase
      .from('event_members_view')
      .select('*')
      .eq('event_id', event.id)
      .order('created_at')
      .then(({ data }) => setMembers((data as EventMember[]) ?? []));
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.functions.invoke<InviteResult>('event-admin-invite', {
      body: { event_id: event.id, email, full_name: fullName, password: password || undefined, member_role: role, reset_password: resetPassword, tabs: tabs.length === allTabs.length ? null : tabs },
    });
    setBusy(false);
    if (error || !data?.ok) {
      onFlash({ kind: 'error', text: data?.message || error?.message || 'No se pudo invitar' });
      return;
    }
    if (data.email_sent === false) {
      onFlash({ kind: 'error', text: `Acceso otorgado, pero el correo no salió: ${data.email_error ?? 'error desconocido'}` });
    } else {
      onFlash({ kind: 'success', text: OUTCOME_TEXT[data.outcome ?? 'existing'] });
    }
    setEmail(''); setFullName(''); setPassword(''); setResetPassword(false); setTabs(allTabs);
    load();
  }

  async function updateMember(m: EventMember, patch: { role?: MemberRole; tabs?: string[] | null }) {
    const { error } = await supabase.from('event_members').update(patch).match({ event_id: m.event_id, user_id: m.user_id });
    if (error) return onFlash({ kind: 'error', text: error.message });
    load();
  }

  async function remove(m: EventMember) {
    if (!confirm(`¿Quitar a ${m.email} de este evento?`)) return;
    const { error } = await supabase.from('event_members').delete().match({ event_id: m.event_id, user_id: m.user_id });
    if (error) return onFlash({ kind: 'error', text: error.message });
    load();
  }

  return (
    <div className="section-card">
      <h3>Administradores del evento</h3>
      <p className="section-hint">
        Ven los registros y ajustes de este evento, nada más. Entran con su correo y contraseña; al darles acceso reciben un correo con las instrucciones.
      </p>

      {members.length === 0 ? (
        <p className="text-muted text-sm">Nadie todavía. El equipo We.Page siempre tiene acceso.</p>
      ) : (
        <div style={{ marginBottom: 16 }}>
          {members.map(m => (
            <div key={m.user_id} className="member-row">
              <div className="member-main">
                <div style={{ fontWeight: 500 }}>{m.full_name || m.email}</div>
                <div className="member-email">{m.email}{m.profile_role === 'super' ? ' · equipo We.Page' : ''}</div>
              </div>
              {isSuper && m.profile_role !== 'super' ? (
                <select className="glass-select" value={m.role} onChange={e => updateMember(m, { role: e.target.value as MemberRole })} title="Permiso">
                  <option value="owner">Dueño</option>
                  <option value="admin">Administrador</option>
                  <option value="viewer">Solo lectura</option>
                </select>
              ) : (
                <span className="badge badge-nuevo">{m.profile_role === 'super' ? 'Equipo' : ROLE_LABEL[m.role]}</span>
              )}
              {isSuper && (
                <button className="btn btn-ghost btn-xs" onClick={() => remove(m)}>Quitar</button>
              )}
              {m.profile_role !== 'super' && (
                <div className="member-tabs">
                  {EVENT_TABS.map(t => {
                    const on = !m.tabs || m.tabs.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        className={`chip chip-xs ${on ? 'active' : ''}`}
                        disabled={!isSuper}
                        title={on ? 'Quitar acceso a esta pestaña' : 'Dar acceso a esta pestaña'}
                        onClick={() => {
                          const next = toggleTab(m.tabs ?? allTabs, t.key);
                          updateMember(m, { tabs: next.length === allTabs.length ? null : next });
                        }}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isSuper && (
        <form onSubmit={invite}>
          <div className="field-grid">
            <div className="input-group">
              <label className="input-label">Correo *</label>
              <input className="input-field" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="cliente@correo.com" />
            </div>
            <div className="input-group">
              <label className="input-label">Nombre</label>
              <input className="input-field" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Ana Pérez" />
            </div>
            <div className="input-group">
              <label className="input-label">Contraseña</label>
              <input className="input-field" type="text" value={password} onChange={e => setPassword(e.target.value)} minLength={8} placeholder="Mínimo 8 caracteres" autoComplete="off" />
              <small className="text-muted text-xs">Solo se usa para cuentas nuevas. Una cuenta que ya existe conserva su contraseña.</small>
              <label className="switch-row" style={{ marginTop: 8, gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={resetPassword} onChange={e => setResetPassword(e.target.checked)} disabled={!password} />
                <span className="text-xs">Si la cuenta ya existe, cambiarle la contraseña por esta</span>
              </label>
            </div>
            <div className="input-group">
              <label className="input-label">Permiso</label>
              <select className="glass-select" value={role} onChange={e => setRole(e.target.value as MemberRole)}>
                <option value="admin">Administrador</option>
                <option value="viewer">Solo lectura</option>
                <option value="owner">Dueño</option>
              </select>
              <small className="text-muted text-xs">Solo lectura consulta sin guardar nada.</small>
            </div>
          </div>
          <div className="input-group" style={{ marginTop: 12 }}>
            <label className="input-label">Pestañas a las que tendrá acceso</label>
            <div className="chip-row">
              {EVENT_TABS.map(t => (
                <button key={t.key} type="button" className={`chip ${tabs.includes(t.key) ? 'active' : ''}`} onClick={() => setTabs(x => toggleTab(x, t.key))}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !email || tabs.length === 0}>
              {busy ? 'Enviando...' : 'Dar acceso'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
