import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Quotation, Client, Payment, QuotationStatus, PaymentType } from '../lib/quotation-types';

export default function QuotationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quotation, setQuotation] = useState<Quotation & { client: Client } | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    type: 'anticipo' as PaymentType,
    amount: '',
    description: '',
    payment_date: new Date().toISOString().split('T')[0],
  });
  const [editingDriveUrl, setEditingDriveUrl] = useState(false);
  const [driveUrlInput, setDriveUrlInput] = useState('');

  useEffect(() => {
    if (id) loadDetails(id);
  }, [id]);

  async function loadDetails(qId: string) {
    try {
      const { data: q } = await supabase
        .from('quotations')
        .select('*, client:clients(*)')
        .eq('id', qId)
        .single();

      if (q) {
        setQuotation(q as Quotation & { client: Client });
        setDriveUrlInput(q.drive_document_url || '');
      }

      const { data: p } = await supabase
        .from('payments')
        .select('*')
        .eq('quotation_id', qId)
        .order('created_at', { ascending: false });

      if (p) setPayments(p as Payment[]);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(status: QuotationStatus) {
    if (!id) return;
    await supabase.from('quotations').update({ status }).eq('id', id);
    if (quotation) setQuotation({ ...quotation, status });
  }

  async function updateClientStatus(clientStatus: string) {
    if (!quotation?.client_id) return;
    await supabase.from('clients').update({ status: clientStatus }).eq('id', quotation.client_id);
    if (quotation?.client) {
      setQuotation({ ...quotation, client: { ...quotation.client, status: clientStatus as any } });
    }
  }

  async function addPayment() {
    if (!id || !paymentForm.amount) return;
    const { error } = await supabase.from('payments').insert({
      quotation_id: id,
      type: paymentForm.type,
      amount: Number(paymentForm.amount),
      description: paymentForm.description || null,
      payment_date: paymentForm.payment_date,
      status: 'pagado',
    });

    if (!error) {
      setShowPaymentForm(false);
      setPaymentForm({ type: 'anticipo', amount: '', description: '', payment_date: new Date().toISOString().split('T')[0] });
      loadDetails(id);
    }
  }

  async function updateDriveUrl() {
    if (!id) return;
    const { error } = await supabase.from('quotations').update({ drive_document_url: driveUrlInput }).eq('id', id);
    if (!error) {
      setEditingDriveUrl(false);
      if (quotation) setQuotation({ ...quotation, drive_document_url: driveUrlInput });
    }
  }

  async function generateGoogleDocument() {
    if (!id || !quotation) return;
    try {
      setGeneratingDoc(true);
      const { data, error } = await supabase.functions.invoke('generate-quotation', {
        body: { quotation_id: id }
      });

      if (error) throw error;
      
      if (data?.success) {
        setQuotation({ ...quotation, drive_document_url: data.pptxUrl });
        setDriveUrlInput(data.pptxUrl);
        // We could also store PDF url in state if we want to show it right away
        alert('Documentos generados y guardados en Google Drive exitosamente.');
      } else {
        throw new Error(data?.error || 'Error desconocido');
      }
    } catch (err: any) {
      console.error('Error generating document:', err);
      alert('Error al generar los documentos: ' + err.message);
    } finally {
      setGeneratingDoc(false);
    }
  }


  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0 }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;
  }

  if (!quotation) {
    return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cotización no encontrada</div>;
  }

  const breakdown = quotation.price_breakdown;
  const totalPaid = payments.filter(p => p.status === 'pagado').reduce((sum, p) => sum + Number(p.amount), 0);
  const remaining = quotation.total_price - totalPaid;

  // Build a readable response summary from the form data
  const responses = quotation.responses;
  const responseEntries: { label: string; value: string }[] = [];

  if (responses.contactName) responseEntries.push({ label: 'Nombre', value: responses.contactName });
  if (responses.contactPhone) responseEntries.push({ label: 'Teléfono', value: responses.contactPhone });
  if (responses.referralSource) responseEntries.push({ label: 'Referencia', value: responses.referralSource });
  if (responses.weddingPlannerName) responseEntries.push({ label: 'Wedding Planner', value: responses.weddingPlannerName });
  if (responses.eventType) responseEntries.push({ label: 'Tipo de evento', value: responses.eventType });
  if (responses.eventDate) responseEntries.push({ label: 'Fecha del evento', value: formatDate(responses.eventDate) });
  if (responses.productType) responseEntries.push({ label: 'Producto', value: responses.productType });
  if (responses.invitationFormat) responseEntries.push({ label: 'Formato', value: responses.invitationFormat });

  // PDF-specific
  if (responses.pdfMultipleEvents !== null) responseEntries.push({ label: 'Múltiples eventos', value: responses.pdfMultipleEvents ? 'Sí' : 'No' });
  if (responses.pdfSubEvents?.length) responseEntries.push({ label: 'Sub-eventos', value: responses.pdfSubEvents.join(', ') });
  if (responses.pdfSameGuests !== null) responseEntries.push({ label: 'Mismos invitados', value: responses.pdfSameGuests ? 'Sí' : 'No' });
  if (responses.pdfMonogram) responseEntries.push({ label: 'Monograma', value: responses.pdfMonogram });
  if (responses.pdfIllustrations !== null) responseEntries.push({ label: 'Ilustraciones', value: responses.pdfIllustrations ? 'Sí' : 'No' });
  if (responses.pdfGiftTable?.length) responseEntries.push({ label: 'Mesa de regalos', value: responses.pdfGiftTable.join(', ') });
  if (responses.pdfExperienceTier) responseEntries.push({ label: 'Mesa experiencias', value: responses.pdfExperienceTier });
  if (responses.pdfAdditionalInfo !== null) responseEntries.push({ label: 'Info adicional', value: responses.pdfAdditionalInfo ? 'Sí' : 'No' });
  if (responses.pdfInfoCategories?.length) responseEntries.push({ label: 'Categorías info', value: responses.pdfInfoCategories.join(', ') });
  if (responses.pdfInfoOptionsCount) responseEntries.push({ label: 'Opciones por cat.', value: responses.pdfInfoOptionsCount });
  if (responses.pdfPersonalized !== null) responseEntries.push({ label: 'Personalizada', value: responses.pdfPersonalized ? 'Sí' : 'No' });
  if (responses.pdfRsvp !== null) responseEntries.push({ label: 'RSVP', value: responses.pdfRsvp ? 'Sí' : 'No' });
  if (responses.pdfSending !== null) responseEntries.push({ label: 'Envío', value: responses.pdfSending ? 'Sí' : 'No' });
  if (responses.pdfConfirmation !== null) responseEntries.push({ label: 'Confirmación', value: responses.pdfConfirmation ? 'Sí' : 'No' });
  if (responses.pdfGuestCountRange) responseEntries.push({ label: 'Rango invitados', value: responses.pdfGuestCountRange });
  if (responses.pdfAdditionalProducts?.length) responseEntries.push({ label: 'Extras', value: responses.pdfAdditionalProducts.join(', ') });

  // Web-specific
  if (responses.webEventCount) responseEntries.push({ label: 'Eventos web', value: String(responses.webEventCount) });
  if (responses.webSeparatePages !== null) responseEntries.push({ label: 'Páginas separadas', value: responses.webSeparatePages ? 'Sí' : 'No' });
  if (responses.webDomainType) responseEntries.push({ label: 'Dominio', value: responses.webDomainType });
  if (responses.webMonogram) responseEntries.push({ label: 'Monograma web', value: responses.webMonogram });
  if (responses.webDesignStyle) responseEntries.push({ label: 'Estilo de diseño', value: responses.webDesignStyle });
  if (responses.webIllustrations !== null) responseEntries.push({ label: 'Ilustraciones', value: responses.webIllustrations ? 'Sí' : 'No' });
  if (responses.webRsvp !== null) responseEntries.push({ label: 'RSVP', value: responses.webRsvp ? 'Sí' : 'No' });
  if (responses.webGiftTable?.length) responseEntries.push({ label: 'Mesa de regalos', value: responses.webGiftTable.join(', ') });
  if (responses.webExperienceTier) responseEntries.push({ label: 'Mesa experiencias', value: responses.webExperienceTier });
  if (responses.webExtras?.length) responseEntries.push({ label: 'Extras web', value: responses.webExtras.join(', ') });
  if (responses.webGuestCountRange) responseEntries.push({ label: 'Rango invitados', value: responses.webGuestCountRange });

  // STD
  if (responses.stdFormat) responseEntries.push({ label: 'Formato STD', value: responses.stdFormat });
  if (responses.stdDesignStyle) responseEntries.push({ label: 'Estilo STD', value: responses.stdDesignStyle });
  if (responses.stdGuestCountRange) responseEntries.push({ label: 'Rango invitados STD', value: responses.stdGuestCountRange });

  // Send/Confirm
  if (responses.sendGuestCountRange) responseEntries.push({ label: 'Rango envío', value: responses.sendGuestCountRange });
  if (responses.confirmGuestCountRange) responseEntries.push({ label: 'Rango confirmación', value: responses.confirmGuestCountRange });

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/cotizaciones')}>← Volver</button>
          <h1 className="admin-page-title">Detalle de cotización</h1>
        </div>
        <div className="no-print">
          <select
            value={quotation.status}
            onChange={(e) => updateStatus(e.target.value as QuotationStatus)}
            className="glass-select"
          >
            {(['pendiente', 'enviada', 'aceptada', 'rechazada'] as QuotationStatus[]).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="quotation-detail-grid">
        {/* Left: Client + Responses */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          {/* Client Card */}
          <div className="glass-card">
            <h3 className="heading-sm" style={{ marginBottom: 16 }}>👤 Cliente</h3>
            <div className="detail-info-grid" style={{ fontSize: 'var(--text-sm)' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Nombre:</span> {quotation.client?.name}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Teléfono:</span> {quotation.client?.phone}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Evento:</span> {quotation.client?.event_type}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Fecha:</span> {quotation.client?.event_date ? formatDate(quotation.client.event_date) : '—'}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Estado:</span> <span className={`badge badge-${quotation.client?.status}`}>{quotation.client?.status}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Idioma:</span> {quotation.client?.lang?.toUpperCase()}</div>
            </div>
            <div style={{ marginTop: 12 }}>
              <select
                value={quotation.client?.status}
                onChange={(e) => updateClientStatus(e.target.value)}
                className="glass-select"
                style={{ width: '100%', fontSize: 'var(--text-xs)' }}
              >
                {(['nuevo', 'cotizado', 'anticipo', 'en_proceso', 'finalizado', 'cancelado']).map(s => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="glass-card">
            <h3 className="heading-sm" style={{ marginBottom: 16 }}>📋 Respuestas del formulario</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {responseEntries.map((entry, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{entry.label}</span>
                  <span style={{ fontWeight: 500, textTransform: 'capitalize', textAlign: 'right' }}>{entry.value.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Price + Payments + Drive */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          {/* Price Breakdown */}
          <div className="glass-card">
            <h3 className="heading-sm" style={{ marginBottom: 16 }}>💰 Desglose de precio</h3>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', flexWrap: 'wrap', gap: 8 }}>
              <span>{breakdown?.baseLabel?.es || 'Base'}</span>
              <span style={{ fontWeight: 600 }}>{formatCurrency(breakdown?.basePrice || 0)}</span>
            </div>

            {breakdown?.items?.map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{item.label.es}</span>
                <span style={{ fontWeight: 500 }}>{formatCurrency(item.amount)}</span>
              </div>
            ))}

            {breakdown?.perGuestItems?.map((item, i) => (
              <div key={`pg-${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {item.label.es} ({item.guestRange} — ${item.pricePerGuest}/invitado × {item.estimatedGuests})
                </span>
                <span style={{ fontWeight: 500 }}>{formatCurrency(item.estimatedTotal)}</span>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', marginTop: 8, fontSize: 'var(--text-lg)', fontWeight: 700 }}>
              <span>Total estimado</span>
              <span style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary-deep)' }}>
                {formatCurrency(quotation.total_price)}
              </span>
            </div>

            {breakdown?.notes?.map((note, i) => (
              <div key={`note-${i}`} className="step-note" style={{ marginTop: 8 }}>{note.es}</div>
            ))}
          </div>

          {/* Drive link management */}
          <div className="glass-card no-print">
            <h3 className="heading-sm" style={{ marginBottom: 12 }}>📄 Documentos</h3>
            {editingDriveUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  className="input-field"
                  placeholder="Pegar link manual de Drive PPTX..."
                  value={driveUrlInput}
                  onChange={(e) => setDriveUrlInput(e.target.value)}
                  style={{ fontSize: 'var(--text-xs)' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={updateDriveUrl}>Guardar Manual</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingDriveUrl(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {quotation.document_status === 'generating' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-primary-deep)', padding: '12px 0', justifyContent: 'center' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>⏳ Generando en Google Drive...</span>
                  </div>
                )}

                {quotation.document_status === 'failed' && (
                  <div style={{ background: '#FFF1F0', border: '1px solid #FFA39E', borderRadius: 8, padding: 12 }}>
                    <p style={{ margin: 0, color: '#CF1322', fontSize: 'var(--text-sm)', fontWeight: 600 }}>Error al generar</p>
                    <p style={{ margin: '4px 0 12px 0', color: '#CF1322', fontSize: 'var(--text-xs)' }}>{quotation.document_error}</p>
                    <button className="btn btn-primary btn-sm" onClick={generateGoogleDocument} disabled={generatingDoc} style={{ width: '100%' }}>
                      {generatingDoc ? 'Reintentando...' : 'Reintentar Generación'}
                    </button>
                  </div>
                )}

                {/* Completed state or manual state */}
                {(quotation.document_status === 'completed' || quotation.drive_document_url) && quotation.document_status !== 'generating' && quotation.document_status !== 'failed' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {quotation.document_pdf_url && (
                      <a href={quotation.document_pdf_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
                        Descargar Cotización (PDF)
                      </a>
                    )}
                    <a href={quotation.drive_document_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
                      Abrir Presentación (Drive) ↗
                    </a>
                  </div>
                )}

                {/* Pending state */}
                {(!quotation.document_status || quotation.document_status === 'pending') && !quotation.drive_document_url && (
                  <>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: 0 }}>No hay documentos generados para esta cotización.</p>
                    <button 
                      className="btn btn-primary btn-sm" 
                      onClick={generateGoogleDocument}
                      disabled={generatingDoc}
                    >
                      {generatingDoc ? 'Generando documentos...' : 'Generar PDF y PPTX'}
                    </button>
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditingDriveUrl(true)}>
                    {quotation.drive_document_url ? 'Cambiar enlaces manualmente' : 'Agregar enlaces manualmente'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Financial Summary */}
          <div className="glass-card">
            <h3 className="heading-sm" style={{ marginBottom: 16 }}>💳 Pagos</h3>

            <div className="stats-grid" style={{ marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Total</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-xl)' }}>{formatCurrency(quotation.total_price)}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Pagado</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-xl)', color: 'var(--color-success)' }}>{formatCurrency(totalPaid)}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Restante</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-xl)', color: remaining > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>{formatCurrency(remaining)}</div>
              </div>
            </div>

            {/* Payment history */}
            {payments.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {payments.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <span className={`badge badge-${p.status}`} style={{ marginRight: 8 }}>{p.type}</span>
                      {p.description && <span style={{ color: 'var(--text-muted)' }}>{p.description}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <span style={{ fontWeight: 600 }}>{formatCurrency(Number(p.amount))}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{formatDate(p.payment_date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Print-only branding header */}
            <div className="print-only-header" style={{ display: 'none', marginBottom: 40 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--color-primary-deep)', paddingBottom: 20 }}>
                <div>
                  <h1 style={{ fontSize: 32, fontWeight: 800, color: 'black', margin: 0 }}>We<span style={{ color: 'var(--color-primary-deep)' }}>.</span></h1>
                  <p style={{ margin: '4px 0', fontSize: 14, color: '#666' }}>Potenciamos tu gran día.</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <h2 style={{ fontSize: 18, margin: 0, color: 'black' }}>COTIZACIÓN PROFESIONAL</h2>
                  <p style={{ margin: '4px 0', fontSize: 12, color: '#666' }}>Fecha: {formatDate(new Date().toISOString())}</p>
                  <p style={{ margin: '4px 0', fontSize: 12, color: '#666' }}>Folio: #{quotation.id.slice(0, 8).toUpperCase()}</p>
                </div>
              </div>
            </div>
            {/* End Print-only header */}

          {/* Add payment */}
          <div className="no-print">
            {showPaymentForm ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
                <select
                  value={paymentForm.type}
                  onChange={(e) => setPaymentForm(p => ({ ...p, type: e.target.value as PaymentType }))}
                  style={{ padding: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                >
                  <option value="anticipo">Anticipo</option>
                  <option value="pago">Pago</option>
                  <option value="finiquito">Finiquito</option>
                  <option value="extra">Extra</option>
                </select>
                <input
                  type="text"
                  placeholder="Monto"
                  value={paymentForm.amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  onChange={(e) => {
                    const val = e.target.value.replace(/,/g, '');
                    if (/^\d*$/.test(val)) {
                      setPaymentForm(p => ({ ...p, amount: val }));
                    }
                  }}
                  style={{ padding: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                />
                <input
                  type="text"
                  placeholder="Descripción (opcional)"
                  value={paymentForm.description}
                  onChange={(e) => setPaymentForm(p => ({ ...p, description: e.target.value }))}
                  style={{ padding: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                />
                <input
                  type="date"
                  value={paymentForm.payment_date}
                  onChange={(e) => setPaymentForm(p => ({ ...p, payment_date: e.target.value }))}
                  style={{ padding: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', colorScheme: 'dark' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={addPayment}>Guardar</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowPaymentForm(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => setShowPaymentForm(true)}>
                + Agregar pago
              </button>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
