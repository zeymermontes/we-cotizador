import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import type { EventRow, EventMember, MemberRole } from '../../../lib/events-types';

interface Props {
  event: EventRow;
  isSuper: boolean;
  onChanged: () => Promise<void>;
  onFlash: (f: { kind: 'success' | 'error'; text: string }) => void;
}

const ROLE_LABEL: Record<MemberRole, string> = { owner: 'Dueño', admin: 'Administrador', viewer: 'Solo lectura' };

interface InviteResult {
  ok: boolean;
  outcome?: 'invited' | 'created' | 'existing' | 'password_updated';
  email_sent?: boolean;
  email_error?: string | null;
  message?: string;
}

const OUTCOME_TEXT: Record<NonNullable<InviteResult['outcome']>, string> = {
  invited: 'Invitación enviada por correo con su enlace de entrada.',
  created: 'Usuario creado; le avisamos por correo. La contraseña se la compartes tú.',
  existing: 'Ya tenía cuenta; le enviamos por correo un enlace de entrada.',
  password_updated: 'Contraseña actualizada; le avisamos por correo.',
};

export default function MembersPanel({ event, isSuper, onFlash }: Props) {
  const [members, setMembers] = useState<EventMember[]>([]);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<MemberRole>('admin');
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
      body: { event_id: event.id, email, full_name: fullName, password: password || undefined, member_role: role },
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
    setEmail(''); setFullName(''); setPassword('');
    load();
  }

  async function remove(m: EventMember) {
    if (!confirm(`¿Quitar a ${m.email} de este evento?`)) return;
    const { error } = await supabase.from('event_members').delete().match({ event_id: m.event_id, user_id: m.user_id });
    if (error) return onFlash({ kind: 'error', text: error.message });
    load();
  }

  const usesPassword = event.login_method === 'password';

  return (
    <div className="section-card">
      <h3>Administradores del evento</h3>
      <p className="section-hint">
        Ven los registros y ajustes de este evento, nada más. Este evento usa{' '}
        <b>{usesPassword ? 'usuario y contraseña' : 'enlace mágico por correo'}</b>.
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
              <span className="badge badge-nuevo">{ROLE_LABEL[m.role]}</span>
              {isSuper && (
                <button className="btn btn-ghost btn-xs" onClick={() => remove(m)}>Quitar</button>
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
            {usesPassword && (
              <div className="input-group">
                <label className="input-label">Contraseña {members.length ? '(vacía = no cambiar)' : '*'}</label>
                <input className="input-field" type="text" value={password} onChange={e => setPassword(e.target.value)} minLength={8} placeholder="Mínimo 8 caracteres" autoComplete="off" />
              </div>
            )}
            <div className="input-group">
              <label className="input-label">Permiso</label>
              <select className="glass-select" value={role} onChange={e => setRole(e.target.value as MemberRole)}>
                <option value="admin">Administrador</option>
                <option value="viewer">Solo lectura</option>
                <option value="owner">Dueño</option>
              </select>
            </div>
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !email}>
              {busy ? 'Enviando...' : usesPassword ? 'Crear acceso' : 'Enviar invitación'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
