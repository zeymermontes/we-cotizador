import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Quotation, Client, QuotationStatus } from '../lib/quotation-types';
import WhatsappButton from '../components/admin/WhatsappButton';

export default function QuotationsPage() {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState<(Quotation & { client: Client })[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilters, setStatusFilters] = useState<QuotationStatus[]>(['pendiente', 'enviada', 'aceptada']);
  const [search, setSearch] = useState('');
  const [outdatedModal, setOutdatedModal] = useState<(Quotation & { client: Client }) | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  useEffect(() => {
    loadQuotations();
  }, []);

  async function loadQuotations() {
    try {
      const { data } = await supabase
        .from('quotations')
        .select('*, client:clients(*), payments(*)')
        .order('created_at', { ascending: false });

      if (data) setQuotations(data as (Quotation & { client: Client })[]);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function regenerateDoc(q: Quotation & { client: Client }) {
    try {
      setRegeneratingId(q.id);
      const { data, error } = await supabase.functions.invoke('generate-quotation', {
        body: { quotation_id: q.id }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Error desconocido');
      // Clear the flag client-side too in case the edge function isn't redeployed yet
      await supabase.from('quotations').update({ document_outdated: false }).eq('id', q.id);
      setOutdatedModal(null);
      await loadQuotations();
      alert('Documento regenerado con los nuevos precios.');
    } catch (err: any) {
      console.error('Error regenerating document:', err);
      alert('Error al regenerar: ' + err.message);
    } finally {
      setRegeneratingId(null);
    }
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0 }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  const filtered = quotations.filter(q => {
    // Multi-select status filter
    if (statusFilters.length > 0 && !statusFilters.includes(q.status)) return false;

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

  const statusOptions: QuotationStatus[] = ['pendiente', 'enviada', 'aceptada', 'rechazada'];

  const toggleStatus = (s: QuotationStatus) => {
    setStatusFilters(prev => 
      prev.includes(s) ? prev.filter(item => item !== s) : [...prev, s]
    );
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar" style={{ marginBottom: 12 }}>
        <h1 className="admin-page-title">Cotizaciones</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            className="input-field"
            placeholder="Buscar por cliente o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260, padding: '10px 16px', fontSize: 'var(--text-sm)' }}
          />
        </div>
      </div>

      <div className="filter-bar" style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
              {s}
            </button>
          ))}
          {statusFilters.length > 0 && (
            <button className="btn btn-ghost btn-xs" onClick={() => setStatusFilters([])} style={{ fontSize: 10 }}>Limpiar</button>
          )}
        </div>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Producto</th>
              <th>Invitados</th>
              <th>Total</th>
              <th>Anticipo</th>
              <th>Extras</th>
              <th>Finiquito</th>
              <th>Por pagar</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th>Doc</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  No se encontraron cotizaciones
                </td>
              </tr>
            ) : (
                filtered.map(q => {
                  const paid = q.payments?.filter(p => p.status === 'pagado') || [];
                  const totalPaid = paid.reduce((sum, p) => sum + Number(p.amount), 0);
                  const anticipo = paid.filter(p => p.type === 'anticipo').reduce((sum, p) => sum + Number(p.amount), 0);
                  const extras = paid.filter(p => p.type === 'pago' || p.type === 'extra').reduce((sum, p) => sum + Number(p.amount), 0);
                  const finiquito = paid.filter(p => p.type === 'finiquito').reduce((sum, p) => sum + Number(p.amount), 0);
                  const remaining = q.total_price - totalPaid;

                  return (
                    <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/cotizaciones/${q.id}`)}>
                      <td style={{ fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span className={`status-indicator status-${q.status}`} title={`Estado: ${q.status}`}></span>
                          <div>
                            <div>{q.client?.name || '—'}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 400, display: 'flex', alignItems: 'center' }}>
                              {q.client?.phone || '—'}
                              <WhatsappButton phone={q.client?.phone} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{q.product_type.replace(/_/g, ' ')}</td>
                      <td>{q.guest_count_range || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{formatCurrency(q.total_price)}</td>
                      <td style={{ color: anticipo > 0 ? 'var(--color-success)' : 'var(--text-muted)' }}>{anticipo > 0 ? formatCurrency(anticipo) : '—'}</td>
                      <td style={{ color: extras > 0 ? 'var(--color-success)' : 'var(--text-muted)' }}>{extras > 0 ? formatCurrency(extras) : '—'}</td>
                      <td style={{ color: finiquito > 0 ? 'var(--color-success)' : 'var(--text-muted)' }}>{finiquito > 0 ? formatCurrency(finiquito) : '—'}</td>
                      <td style={{ fontWeight: 600, color: remaining > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                        {remaining > 0 ? formatCurrency(remaining) : 'Pagado'}
                      </td>
                      <td><span className={`badge badge-${q.status}`}>{q.status}</span></td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatDate(q.created_at)}</td>
                      <td>
                        {q.document_pdf_url ? (
                          <a
                            href={q.document_pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (q.document_outdated) { e.preventDefault(); setOutdatedModal(q); }
                            }}
                            style={{ fontSize: 'var(--text-xs)', color: q.document_outdated ? 'var(--color-warning)' : 'var(--color-primary-deep)', fontWeight: 600 }}
                            title={q.document_outdated ? 'Falta regenerar — los precios cambiaron' : undefined}
                          >
                            PDF{q.document_outdated ? ' ⚠️' : ''}
                          </a>
                        ) : q.drive_document_url ? (
                          <a
                            href={q.drive_document_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (q.document_outdated) { e.preventDefault(); setOutdatedModal(q); }
                            }}
                            style={{ fontSize: 'var(--text-xs)', color: q.document_outdated ? 'var(--color-warning)' : undefined }}
                            title={q.document_outdated ? 'Falta regenerar — los precios cambiaron' : undefined}
                          >
                            PPTX{q.document_outdated ? ' ⚠️' : ''}
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
                  );
                })
            )}
          </tbody>
        </table>
      </div>

      {/* Outdated document modal */}
      {outdatedModal && (
        <div
          onClick={() => regeneratingId ? null : setOutdatedModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card"
            style={{ maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div>
              <h3 className="heading-sm" style={{ margin: 0, color: '#AD6800' }}>⚠️ Falta regenerar</h3>
              <p style={{ margin: '8px 0 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Los precios de <strong>{outdatedModal.client?.name || 'esta cotización'}</strong> cambiaron desde la última generación. El documento actual no refleja los nuevos precios.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => regenerateDoc(outdatedModal)}
                disabled={!!regeneratingId}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {regeneratingId ? 'Regenerando...' : '🔄 Regenerar'}
              </button>

              {outdatedModal.drive_document_url && (
                <a
                  href={outdatedModal.drive_document_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  Abrir presentación ↗
                </a>
              )}

              {outdatedModal.document_pdf_url && (
                <a
                  href={outdatedModal.document_pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'center', border: '1px solid var(--border-default)' }}
                >
                  Descargar actual
                </a>
              )}

              <button
                className="btn btn-ghost btn-xs"
                onClick={() => setOutdatedModal(null)}
                disabled={!!regeneratingId}
                style={{ width: '100%', justifyContent: 'center', opacity: 0.6 }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
