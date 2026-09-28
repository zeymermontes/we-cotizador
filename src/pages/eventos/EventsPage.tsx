import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import {
  type EventRow, type EventLanguage, type LoginMethod,
  EVENT_STATUS_BADGE, EVENT_STATUS_LABEL, LANGUAGE_LABEL, slugify,
} from '../../lib/events-types';

interface NewEventForm {
  name: string;
  slug: string;
  slugTouched: boolean;
  event_date: string;
  venue: string;
  languages: EventLanguage[];
  default_language: EventLanguage;
  login_method: LoginMethod;
}

const EMPTY: NewEventForm = {
  name: '',
  slug: '',
  slugTouched: false,
  event_date: '',
  venue: '',
  languages: ['es'],
  default_language: 'es',
  login_method: 'magic_link',
};

export default function EventsPage() {
  const navigate = useNavigate();
  const { isSuper, session } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewEventForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .order('event_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        setEvents((data as EventRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  const visible = events.filter(e => showArchived || e.status !== 'archived');

  function toggleLanguage(lang: EventLanguage) {
    setForm(f => {
      const has = f.languages.includes(lang);
      if (has && f.languages.length === 1) return f; // siempre uno al menos
      const languages = has ? f.languages.filter(l => l !== lang) : [...f.languages, lang];
      const default_language = languages.includes(f.default_language) ? f.default_language : languages[0];
      return { ...f, languages, default_language };
    });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const slug = slugify(form.slug || form.name);
    if (slug.length < 3) return setError('El enlace debe tener al menos 3 caracteres.');
    setSaving(true);
    const { data, error: insErr } = await supabase
      .from('events')
      .insert({
        name: form.name.trim(),
        slug,
        event_date: form.event_date ? new Date(form.event_date).toISOString() : null,
        venue: form.venue.trim() || null,
        languages: form.languages,
        default_language: form.default_language,
        login_method: form.login_method,
        created_by: session?.user.id ?? null,
      })
      .select('id')
      .single();
    setSaving(false);
    if (insErr) {
      setError(insErr.message.includes('events_slug_key') ? 'Ese enlace ya está en uso, elige otro.' : insErr.message);
      return;
    }
    navigate(`/admin/eventos/${data.id}/ajustes`);
  }

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar" style={{ marginBottom: 24 }}>
        <h1 className="admin-page-title">Eventos</h1>
        {isSuper && (
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY); setCreating(true); }}>
            + Nuevo evento
          </button>
        )}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 720 }}>
        Cada evento tiene su formulario de registro, su lista de invitados, sus invitaciones con QR y su scanner de acceso.
      </p>

      {isSuper && events.some(e => e.status === 'archived') && (
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 'var(--text-sm)', marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Mostrar archivados
        </label>
      )}

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Evento</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th>Idiomas</th>
              <th>Enlace</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                  {isSuper ? 'Aún no hay eventos. Crea el primero con el botón de arriba.' : 'Todavía no tienes eventos asignados.'}
                </td>
              </tr>
            )}
            {visible.map(ev => (
              <tr key={ev.id} onClick={() => navigate(`/admin/eventos/${ev.id}`)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 600 }}>
                  {ev.name}
                  {ev.venue && <div className="text-muted text-xs">{ev.venue}</div>}
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{formatDate(ev.event_date)}</td>
                <td><span className={`badge ${EVENT_STATUS_BADGE[ev.status]}`}>{EVENT_STATUS_LABEL[ev.status]}</span></td>
                <td style={{ color: 'var(--text-muted)' }}>{ev.languages.map(l => LANGUAGE_LABEL[l]).join(' · ')}</td>
                <td><code style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>/{ev.slug}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <div className="modal-backdrop" onClick={() => !saving && setCreating(false)}>
          <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={create}>
            <h2>Nuevo evento</h2>

            {error && <div className="inline-alert error">{error}</div>}

            <div className="input-group">
              <label className="input-label">Nombre del evento *</label>
              <input
                className="input-field"
                value={form.name}
                onChange={e => setForm(f => ({
                  ...f,
                  name: e.target.value,
                  slug: f.slugTouched ? f.slug : slugify(e.target.value),
                }))}
                placeholder="Boda Ana & Luis"
                required
                autoFocus
              />
            </div>

            <div className="input-group">
              <label className="input-label">Enlace *</label>
              <input
                className="input-field"
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value), slugTouched: true }))}
                placeholder="boda-ana-luis"
                required
              />
              <div className="text-muted text-xs" style={{ marginTop: 4 }}>
                registro.we.page/<b>{form.slug || 'enlace'}</b>
              </div>
            </div>

            <div className="field-grid">
              <div className="input-group">
                <label className="input-label">Fecha y hora</label>
                <input
                  className="input-field"
                  type="datetime-local"
                  value={form.event_date}
                  onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Lugar</label>
                <input
                  className="input-field"
                  value={form.venue}
                  onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                  placeholder="Hacienda ..."
                />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Idiomas del formulario</label>
              <div className="chip-row">
                {(['es', 'en'] as EventLanguage[]).map(l => (
                  <button
                    type="button"
                    key={l}
                    className={`chip ${form.languages.includes(l) ? 'active' : ''}`}
                    onClick={() => toggleLanguage(l)}
                  >
                    {LANGUAGE_LABEL[l]}
                  </button>
                ))}
              </div>
              {form.languages.length === 2 && (
                <div className="text-muted text-xs" style={{ marginTop: 6 }}>
                  Bilingüe: cada pregunta y opción se captura en los dos idiomas. Idioma inicial:{' '}
                  <select
                    className="glass-select"
                    value={form.default_language}
                    onChange={e => setForm(f => ({ ...f, default_language: e.target.value as EventLanguage }))}
                    style={{ marginLeft: 4 }}
                  >
                    {form.languages.map(l => <option key={l} value={l}>{LANGUAGE_LABEL[l]}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="input-group">
              <label className="input-label">Acceso de los administradores del evento</label>
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip ${form.login_method === 'magic_link' ? 'active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, login_method: 'magic_link' }))}
                >
                  ✉️ Enlace mágico por correo
                </button>
                <button
                  type="button"
                  className={`chip ${form.login_method === 'password' ? 'active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, login_method: 'password' }))}
                >
                  🔑 Usuario y contraseña
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(false)} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !form.name.trim()}>
                {saving ? 'Creando...' : 'Crear evento'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
