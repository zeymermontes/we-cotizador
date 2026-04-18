import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Quotation, Client } from '../lib/quotation-types';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalClients: 0,
    pendingQuotations: 0,
    totalRevenue: 0,
  });
  const [recentQuotations, setRecentQuotations] = useState<(Quotation & { client: Client })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      // Get client count
      const { count: clientCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      // Get pending quotations count
      const { count: pendingCount } = await supabase
        .from('quotations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pendiente');

      // Get total revenue from paid payments
      const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('status', 'pagado');

      const totalRevenue = payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      setStats({
        totalClients: clientCount || 0,
        pendingQuotations: pendingCount || 0,
        totalRevenue,
      });

      // Get recent quotations
      const { data: quotations } = await supabase
        .from('quotations')
        .select('*, client:clients(*)')
        .order('created_at', { ascending: false })
        .limit(10);

      if (quotations) {
        setRecentQuotations(quotations as (Quotation & { client: Client })[]);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
    }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  const getStatusBadge = (status: string) => (
    <span className={`badge badge-${status}`}>{status.replace('_', ' ')}</span>
  );

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '64px', color: 'var(--text-muted)' }}>Cargando...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar">
        <h1 className="admin-page-title">Panel principal</h1>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">👥 Total clientes</div>
          <div className="stat-value">{stats.totalClients}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">📋 Cotizaciones pendientes</div>
          <div className="stat-value">{stats.pendingQuotations}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">💰 Ingresos totales</div>
          <div className="stat-value">{formatCurrency(stats.totalRevenue)}</div>
        </div>
      </div>

      {/* Recent Activity */}
      <h2 className="heading-sm" style={{ marginBottom: 'var(--space-md)' }}>Actividad reciente</h2>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Producto</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {recentQuotations.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  No hay cotizaciones aún
                </td>
              </tr>
            ) : (
              recentQuotations.map(q => (
                <tr key={q.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{q.client?.name || '—'}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      {q.client?.phone || '—'}
                    </div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>
                    {q.product_type.replace(/_/g, ' ')}
                  </td>
                  <td style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                    {formatCurrency(q.total_price)}
                  </td>
                  <td>{getStatusBadge(q.status)}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {formatDate(q.created_at)}
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
