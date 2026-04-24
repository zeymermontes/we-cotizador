import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Client, ClientStatus } from '../lib/quotation-types';

export default function ClientsPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilters, setStatusFilters] = useState<ClientStatus[]>([]);
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
    if (statusFilters.length > 0 && !statusFilters.includes(c.status)) return false;
    if (search) {
      const s = search.toLowerCase();
      return c.name.toLowerCase().includes(s) || c.phone.includes(s);
    }
    return true;
  });

  const statusOptions: ClientStatus[] = ['nuevo', 'cotizado', 'anticipo', 'en_proceso', 'finalizado', 'cancelado'];

  const toggleStatus = (s: ClientStatus) => {
    setStatusFilters(prev => 
      prev.includes(s) ? prev.filter(item => item !== s) : [...prev, s]
    );
  };

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
        </div>
      </div>

      <div className="filter-bar" style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estado:</span>
        {statusOptions.map(s => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={`badge badge-${s}`}
            style={{ 
              cursor: 'pointer', 
              opacity: statusFilters.length === 0 || statusFilters.includes(s) ? 1 : 0.4,
              border: statusFilters.includes(s) ? '1px solid var(--text-primary)' : '1px solid transparent',
              transition: 'all 0.2s',
              padding: '4px 10px'
            }}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
        {statusFilters.length > 0 && (
          <button className="btn btn-ghost btn-xs" onClick={() => setStatusFilters([])} style={{ fontSize: 10 }}>Limpiar</button>
        )}
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
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={`status-indicator status-${c.status}`} title={`Estado: ${c.status}`}></span>
                      {c.name}
                    </div>
                  </td>
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
