import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { publicUrls } from '../../lib/host';
import {
  type EventRow, type EventStatus, type EventLanguage, type LoginMethod,
  EVENT_STATUS_BADGE, EVENT_STATUS_LABEL, LANGUAGE_LABEL, slugify,
} from '../../lib/events-types';
import BrandingEditor from '../../components/admin/eventos/BrandingEditor';
import MembersPanel from '../../components/admin/eventos/MembersPanel';
import ScreensEditor from '../../components/admin/eventos/ScreensEditor';
import FormBuilder from '../../components/admin/eventos/builder/FormBuilder';
import RegistrationsPanel from '../../components/admin/eventos/registros/RegistrationsPanel';
import CommunicationsPanel from '../../components/admin/eventos/comunicaciones/CommunicationsPanel';
import SendEmailAction from '../../components/admin/eventos/comunicaciones/SendEmailAction';
import InvitationsPanel from '../../components/admin/eventos/invitaciones/InvitationsPanel';
import InvitationActions from '../../components/admin/eventos/invitaciones/InvitationActions';

type Tab = 'resumen' | 'formulario' | 'registros' | 'comunicaciones' | 'invitaciones' | 'scanner' | 'ajustes';

const TABS: { key: Tab; label: string; soon?: string; superOnly?: boolean }[] = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'formulario', label: 'Formulario' },
  { key: 'registros', label: 'Registros' },
  { key: 'comunicaciones', label: 'Comunicaciones' },
  { key: 'invitaciones', label: 'Invitaciones', superOnly: true },
  { key: 'scanner', label: 'Scanner', soon: 'Fase 6' },
  { key: 'ajustes', label: 'Ajustes' },
];

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventDetailPage() {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { isSuper } = useAuth();
  const tab: Tab = (TABS.some(t => t.key === tabParam) ? tabParam : 'resumen') as Tab;

  const [event, setEvent] = useState<EventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    await supabase.from('events').select('*').eq('id', id).maybeSingle().then(({ data }) => {
      if (!data) setNotFound(true);
      setEvent((data as EventRow | null) ?? null);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  /** Guarda columnas sueltas y refresca el estado local. */
  async function patch(fields: Partial<EventRow>, okText = 'Guardado') {
    if (!event) return false;
    const { error } = await supabase.from('events').update(fields).eq('id', event.id);
    if (error) {
      setFlash({ kind: 'error', text: error.message.includes('events_slug_key') ? 'Ese enlace ya está en uso.' : error.message });
      return false;
    }
    setEvent(prev => (prev ? { ...prev, ...fields } : prev));
    setFlash({ kind: 'success', text: okText });
    return true;
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;
  if (notFound || !event) {
    return (
      <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>
        Este evento no existe o no tienes acceso. <Link to="/admin/eventos">Volver</Link>
      </div>
    );
  }

  const urls = publicUrls(event.slug);

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
        <div>
          <Link to="/admin/eventos" className="text-muted text-sm">← Eventos</Link>
          <h1 className="admin-page-title" style={{ marginTop: 4 }}>{event.name}</h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <span className={`badge ${EVENT_STATUS_BADGE[event.status]}`}>{EVENT_STATUS_LABEL[event.status]}</span>
            <span className="text-muted text-xs">{event.languages.map(l => LANGUAGE_LABEL[l]).join(' · ')}</span>
            {event.event_date && (
              <span className="text-muted text-xs">
                {new Date(event.event_date).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            )}
          </div>
        </div>
        <StatusControl event={event} isSuper={isSuper} onChange={(status) => patch({ status }, `Evento ${EVENT_STATUS_LABEL[status].toLowerCase()}`)} />
      </div>

      {flash && <div className={`inline-alert ${flash.kind}`}>{flash.text}</div>}

      <div className="tabs">
        {TABS.filter(t => !t.superOnly || isSuper).map(t => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => navigate(`/admin/eventos/${event.id}/${t.key}`)}
          >
            {t.label}
            {t.soon && <span className="tab-soon">{t.soon.toUpperCase()}</span>}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <Resumen event={event} urls={urls} />}
      {tab === 'formulario' && <FormBuilder event={event} />}
      {tab === 'registros' && <RegistrationsPanel event={event} extraBulkActions={ctx => <><SendEmailAction ctx={ctx} /><InvitationActions ctx={ctx} /></>} />}
      {tab === 'comunicaciones' && <CommunicationsPanel event={event} onEventPatch={patch} />}
      {tab === 'invitaciones' && isSuper && <InvitationsPanel event={event} onEventPatch={patch} />}
      {tab === 'ajustes' && (
        <Ajustes event={event} isSuper={isSuper} onPatch={patch} onReload={load} onFlash={setFlash} />
      )}
      {!['resumen', 'ajustes', 'formulario', 'registros', 'comunicaciones', 'invitaciones'].includes(tab) && (
        <div className="section-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          Esta sección llega en la {TABS.find(t => t.key === tab)?.soon?.toLowerCase()}. Mientras, configura el evento en <b>Ajustes</b>.
        </div>
      )}
    </div>
  );
}

// ─── Estado (publicar / cerrar / archivar) ───────────────────

function StatusControl({ event, isSuper, onChange }: { event: EventRow; isSuper: boolean; onChange: (s: EventStatus) => void }) {
  const next: { label: string; to: EventStatus; className: string; superOnly?: boolean; confirm?: string }[] = [];
  if (event.status === 'draft') next.push({ label: 'Publicar', to: 'published', className: 'btn-primary' });
  if (event.status === 'published') next.push({ label: 'Cerrar registro', to: 'closed', className: 'btn-secondary', confirm: 'El formulario dejará de recibir registros. El scanner sigue funcionando. ¿Cerrar?' });
  if (event.status === 'closed') next.push({ label: 'Reabrir registro', to: 'published', className: 'btn-secondary' });
  if (event.status !== 'archived' && event.status !== 'draft') next.push({ label: 'Archivar', to: 'archived', className: 'btn-ghost', superOnly: true, confirm: 'El evento se ocultará del público y de la lista. ¿Archivar?' });
  if (event.status === 'archived') next.push({ label: 'Restaurar', to: 'closed', className: 'btn-secondary', superOnly: true });

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {next.filter(n => !n.superOnly || isSuper).map(n => (
        <button
          key={n.to + n.label}
          className={`btn btn-sm ${n.className}`}
          onClick={() => { if (!n.confirm || confirm(n.confirm)) onChange(n.to); }}
        >
          {n.label}
        </button>
      ))}
    </div>
  );
}

// ─── Resumen ─────────────────────────────────────────────────

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
      <code>{value}</code>
      <a href={value} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs">Abrir</a>
      <button
        className="btn btn-secondary btn-xs"
        onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      >
        {copied ? '✓ Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function Resumen({ event, urls }: { event: EventRow; urls: { registro: string; acceso: string } }) {
  const [counts, setCounts] = useState({ total: 0, people: 0, invited: 0, confirmed: 0, checked_in: 0 });

  useEffect(() => {
    let cancelled = false;
    supabase.from('registrations').select('status, party_size').eq('event_id', event.id).then(({ data }) => {
      if (cancelled || !data) return;
      const rows = data as { status: string; party_size: number }[];
      const active = rows.filter(r => r.status !== 'cancelled');
      setCounts({
        total: active.length,
        people: active.reduce((s, r) => s + (r.party_size ?? 1), 0),
        invited: rows.filter(r => ['invited', 'confirmed', 'checked_in'].includes(r.status)).length,
        confirmed: rows.filter(r => ['confirmed', 'checked_in'].includes(r.status)).length,
        checked_in: rows.filter(r => r.status === 'checked_in').length,
      });
    });
    return () => { cancelled = true; };
  }, [event.id]);

  return (
    <>
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card"><div className="stat-label">Registros</div><div className="stat-value">{counts.total}</div><div className="text-muted text-xs">{counts.people} personas</div></div>
        <div className="stat-card"><div className="stat-label">Invitados</div><div className="stat-value">{counts.invited}</div></div>
        <div className="stat-card"><div className="stat-label">Confirmados</div><div className="stat-value">{counts.confirmed}</div></div>
        <div className="stat-card"><div className="stat-label">Asistieron</div><div className="stat-value">{counts.checked_in}</div></div>
      </div>

      <div className="section-card">
        <h3>Enlaces públicos</h3>
        <p className="section-hint">
          {event.status === 'draft'
            ? 'El evento está en borrador: los enlaces mostrarán "no disponible" hasta que lo publiques.'
            : 'Comparte el de registro con tus invitados. El de acceso es para el staff en la puerta (pide PIN).'}
        </p>
        <CopyRow label="Registro" value={urls.registro} />
        <CopyRow label="Acceso" value={urls.acceso} />
      </div>
    </>
  );
}

// ─── Ajustes ─────────────────────────────────────────────────

interface AjustesProps {
  event: EventRow;
  isSuper: boolean;
  onPatch: (fields: Partial<EventRow>, okText?: string) => Promise<boolean>;
  onReload: () => Promise<void>;
  onFlash: (f: { kind: 'success' | 'error'; text: string }) => void;
}

function Ajustes({ event, isSuper, onPatch, onReload, onFlash }: AjustesProps) {
  const navigate = useNavigate();
  const [general, setGeneral] = useState({
    name: event.name,
    slug: event.slug,
    description: event.description ?? '',
    event_date: toLocalInput(event.event_date),
    venue: event.venue ?? '',
    capacity: event.capacity?.toString() ?? '',
    registration_closes_at: toLocalInput(event.registration_closes_at),
    languages: event.languages,
    default_language: event.default_language,
    login_method: event.login_method,
  });
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [pin, setPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  function toggleLanguage(lang: EventLanguage) {
    setGeneral(g => {
      const has = g.languages.includes(lang);
      if (has && g.languages.length === 1) return g;
      const languages = has ? g.languages.filter(l => l !== lang) : [...g.languages, lang];
      const default_language = languages.includes(g.default_language) ? g.default_language : languages[0];
      return { ...g, languages, default_language };
    });
  }

  async function saveGeneral(e: React.FormEvent) {
    e.preventDefault();
    setSavingGeneral(true);
    const capacity = general.capacity.trim() ? parseInt(general.capacity, 10) : null;
    await onPatch({
      name: general.name.trim(),
      slug: slugify(general.slug),
      description: general.description.trim() || null,
      event_date: general.event_date ? new Date(general.event_date).toISOString() : null,
      venue: general.venue.trim() || null,
      capacity: capacity && capacity > 0 ? capacity : null,
      registration_closes_at: general.registration_closes_at ? new Date(general.registration_closes_at).toISOString() : null,
      languages: general.languages,
      default_language: general.default_language,
      login_method: general.login_method as LoginMethod,
    });
    setSavingGeneral(false);
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[0-9]{4,8}$/.test(pin)) return onFlash({ kind: 'error', text: 'El PIN debe tener entre 4 y 8 dígitos.' });
    setSavingPin(true);
    const { error } = await supabase.rpc('set_event_scanner_pin', { p_event_id: event.id, p_pin: pin });
    setSavingPin(false);
    if (error) return onFlash({ kind: 'error', text: error.message });
    setPin('');
    onFlash({ kind: 'success', text: 'PIN del scanner actualizado' });
  }

  async function deleteEvent() {
    if (!confirm(`¿Eliminar "${event.name}" definitivamente? Se borran su formulario, registros e imágenes. Esto no se puede deshacer.`)) return;
    if (!confirm('Última confirmación: ¿eliminar el evento?')) return;
    const { error } = await supabase.from('events').delete().eq('id', event.id);
    if (error) return onFlash({ kind: 'error', text: error.message });
    navigate('/admin/eventos');
  }

  return (
    <>
      <form className="section-card" onSubmit={saveGeneral}>
        <h3>General</h3>
        <p className="section-hint">Nombre, fecha, lugar, idiomas y acceso de los administradores.</p>

        <div className="field-grid">
          <div className="input-group">
            <label className="input-label">Nombre *</label>
            <input className="input-field" value={general.name} onChange={e => setGeneral(g => ({ ...g, name: e.target.value }))} required />
          </div>
          <div className="input-group">
            <label className="input-label">Enlace *</label>
            <input className="input-field" value={general.slug} onChange={e => setGeneral(g => ({ ...g, slug: slugify(e.target.value) }))} required />
            <div className="text-muted text-xs" style={{ marginTop: 4 }}>Cambiarlo rompe los enlaces ya compartidos.</div>
          </div>
          <div className="input-group">
            <label className="input-label">Fecha y hora</label>
            <input className="input-field" type="datetime-local" value={general.event_date} onChange={e => setGeneral(g => ({ ...g, event_date: e.target.value }))} />
          </div>
          <div className="input-group">
            <label className="input-label">Lugar</label>
            <input className="input-field" value={general.venue} onChange={e => setGeneral(g => ({ ...g, venue: e.target.value }))} />
          </div>
          <div className="input-group">
            <label className="input-label">Cupo máximo</label>
            <input className="input-field" type="number" min={1} value={general.capacity} onChange={e => setGeneral(g => ({ ...g, capacity: e.target.value }))} placeholder="Sin límite" />
          </div>
          <div className="input-group">
            <label className="input-label">Cierre de registro</label>
            <input className="input-field" type="datetime-local" value={general.registration_closes_at} onChange={e => setGeneral(g => ({ ...g, registration_closes_at: e.target.value }))} />
          </div>
        </div>

        <div className="input-group" style={{ marginTop: 16 }}>
          <label className="input-label">Descripción interna</label>
          <textarea className="input-field" rows={2} value={general.description} onChange={e => setGeneral(g => ({ ...g, description: e.target.value }))} />
        </div>

        <div className="field-grid" style={{ marginTop: 16 }}>
          <div className="input-group">
            <label className="input-label">Idiomas del formulario</label>
            <div className="chip-row">
              {(['es', 'en'] as EventLanguage[]).map(l => (
                <button type="button" key={l} className={`chip ${general.languages.includes(l) ? 'active' : ''}`} onClick={() => toggleLanguage(l)}>
                  {LANGUAGE_LABEL[l]}
                </button>
              ))}
              {general.languages.length === 2 && (
                <select className="glass-select" value={general.default_language} onChange={e => setGeneral(g => ({ ...g, default_language: e.target.value as EventLanguage }))}>
                  {general.languages.map(l => <option key={l} value={l}>Inicial: {LANGUAGE_LABEL[l]}</option>)}
                </select>
              )}
            </div>
          </div>
          {isSuper && (
            <div className="input-group">
              <label className="input-label">Acceso de administradores del evento</label>
              <div className="chip-row">
                <button type="button" className={`chip ${general.login_method === 'magic_link' ? 'active' : ''}`} onClick={() => setGeneral(g => ({ ...g, login_method: 'magic_link' }))}>✉️ Enlace mágico</button>
                <button type="button" className={`chip ${general.login_method === 'password' ? 'active' : ''}`} onClick={() => setGeneral(g => ({ ...g, login_method: 'password' }))}>🔑 Contraseña</button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={savingGeneral}>{savingGeneral ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </form>

      <BrandingEditor
        event={event}
        onSave={(branding) => onPatch({ branding }, 'Branding guardado')}
      />

      <ScreensEditor
        event={event}
        onSave={(screens) => onPatch({ screens }, 'Textos guardados')}
      />

      <form className="section-card" onSubmit={savePin}>
        <h3>PIN del scanner</h3>
        <p className="section-hint">
          El staff lo escribe en <code>acceso.we.page/{event.slug}</code> para empezar a escanear. Solo dígitos, de 4 a 8. No se puede ver, solo cambiar.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input-field"
            style={{ maxWidth: 200, letterSpacing: '0.2em' }}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Nuevo PIN"
          />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={savingPin || pin.length < 4}>
            {savingPin ? 'Guardando...' : 'Cambiar PIN'}
          </button>
        </div>
      </form>

      <MembersPanel event={event} isSuper={isSuper} onChanged={onReload} onFlash={onFlash} />

      {isSuper && (
        <div className="section-card" style={{ borderColor: 'rgba(248,113,113,0.4)' }}>
          <h3 style={{ color: 'var(--color-error)' }}>Zona de peligro</h3>
          <p className="section-hint">Eliminar borra el evento y todo lo que cuelga de él. Si solo quieres ocultarlo, usa "Archivar" arriba.</p>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={deleteEvent}>Eliminar evento</button>
        </div>
      )}
    </>
  );
}
