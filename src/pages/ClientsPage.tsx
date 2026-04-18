import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Client, ClientStatus } from '../lib/quotation-types';

export default function ClientsPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ClientStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => { loadClients(); }, []);

  async function loadClients() {
    try {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });
      if (data) setClients(data as Client[]);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  const filtered = clients.filter(c => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return c.name.toLowerCase().includes(s) || c.phone.includes(s);
    }
    return true;
  });

  const statusOptions: (ClientStatus | 'all')[] = ['all', 'nuevo', 'cotizado', 'anticipo', 'en_proceso', 'finalizado', 'cancelado'];

  if (loading) return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar">
        <h1 className="admin-page-title">Clientes</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            className="input-field"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, padding: '10px 16px', fontSize: 'var(--text-sm)', borderBottom: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ClientStatus | 'all')}
            style={{ padding: '10px 16px', fontSize: 'var(--text-sm)', background: 'var(--bg-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          >
            {statusOptions.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'Todos' : s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Evento</th>
              <th>Fecha evento</th>
              <th>Referencia</th>
              <th>Estado</th>
              <th>Registrado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  No se encontraron clientes
                </td>
              </tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/cotizaciones`)}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td>{c.phone}</td>
                  <td style={{ textTransform: 'capitalize' }}>{c.event_type?.replace(/_/g, ' ') || '—'}</td>
                  <td>{c.event_date ? formatDate(c.event_date) : '—'}</td>
                  <td style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{c.referral_source?.replace(/_/g, ' ') || '—'}</td>
                  <td><span className={`badge badge-${c.status}`}>{c.status?.replace('_', ' ')}</span></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{formatDate(c.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
