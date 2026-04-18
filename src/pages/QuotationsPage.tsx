import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Quotation, Client, QuotationStatus } from '../lib/quotation-types';

export default function QuotationsPage() {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState<(Quotation & { client: Client })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<QuotationStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadQuotations();
  }, []);

  async function loadQuotations() {
    try {
      const { data } = await supabase
        .from('quotations')
        .select('*, client:clients(*)')
        .order('created_at', { ascending: false });

      if (data) setQuotations(data as (Quotation & { client: Client })[]);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0 }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  const filtered = quotations.filter(q => {
    if (filter !== 'all' && q.status !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        q.client?.name?.toLowerCase().includes(s) ||
        q.client?.phone?.includes(s) ||
        q.product_type.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const statusOptions: (QuotationStatus | 'all')[] = ['all', 'pendiente', 'enviada', 'aceptada', 'rechazada'];

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar">
        <h1 className="admin-page-title">Cotizaciones</h1>
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
            onChange={(e) => setFilter(e.target.value as QuotationStatus | 'all')}
            style={{
              padding: '10px 16px',
              fontSize: 'var(--text-sm)',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
            }}
          >
            {statusOptions.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'Todos' : s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Producto</th>
              <th>Rango invitados</th>
              <th>Total estimado</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th>PPTX</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  No se encontraron cotizaciones
                </td>
              </tr>
            ) : (
              filtered.map(q => (
                <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/cotizaciones/${q.id}`)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{q.client?.name || '—'}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{q.client?.phone || '—'}</div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{q.product_type.replace(/_/g, ' ')}</td>
                  <td>{q.guest_count_range || '—'}</td>
                  <td style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{formatCurrency(q.total_price)}</td>
                  <td><span className={`badge badge-${q.status}`}>{q.status}</span></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{formatDate(q.created_at)}</td>
                  <td>
                    {q.drive_document_url ? (
                      <a
                        href={q.drive_document_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 'var(--text-xs)' }}
                      >
                        📄 Ver PPTX
                      </a>
                    ) : '—'}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/cotizaciones/${q.id}`); }}
                    >
                      Ver →
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
