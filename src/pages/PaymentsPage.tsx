import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Payment } from '../lib/quotation-types';

export default function PaymentsPage() {
  const [payments, setPayments] = useState<(Payment & { quotation?: { client?: { name: string; phone: string } } })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadPayments(); }, []);

  async function loadPayments() {
    try {
      const { data } = await supabase
        .from('payments')
        .select('*, quotation:quotations(client:clients(name, phone))')
        .order('created_at', { ascending: false });
      if (data) setPayments(data as typeof payments);
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

  const totalPaid = payments.filter(p => p.status === 'pagado').reduce((sum, p) => sum + Number(p.amount), 0);

  if (loading) return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar">
        <h1 className="admin-page-title">Pagos</h1>
        <div className="stat-card" style={{ padding: '12px 24px' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Total recibido</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-xl)', color: 'var(--color-success)' }}>
            {formatCurrency(totalPaid)}
          </div>
        </div>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Monto</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th>Fecha pago</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  No hay pagos registrados
                </td>
              </tr>
            ) : (
              payments.map(p => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{(p.quotation as { client?: { name: string } })?.client?.name || '—'}</div>
                  </td>
                  <td><span className={`badge badge-${p.status}`} style={{ textTransform: 'capitalize' }}>{p.type}</span></td>
                  <td style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{formatCurrency(Number(p.amount))}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{p.description || '—'}</td>
                  <td><span className={`badge badge-${p.status}`}>{p.status}</span></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{formatDate(p.payment_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
