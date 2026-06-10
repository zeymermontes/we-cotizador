import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Quotation, Client, Payment, QuotationStatus, PaymentType, QuotationFormData, PriceBreakdown } from '../lib/quotation-types';
import { calculatePrice } from '../lib/pricing-engine';
import ResponseEditor from '../components/admin/ResponseEditor';
import WhatsappButton from '../components/admin/WhatsappButton';

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
  const [showResponseEditor, setShowResponseEditor] = useState(false);
  const [editingPrices, setEditingPrices] = useState(false);
  const [priceDraft, setPriceDraft] = useState<PriceBreakdown | null>(null);
  const [savingPrices, setSavingPrices] = useState(false);

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
        // Clear the "needs regeneration" flag (edge function also does this,
        // but reset here too so it works even before the function is redeployed)
        await supabase.from('quotations').update({ document_outdated: false }).eq('id', id);
        // Refresh all details to get the newest status and links from DB
        await loadDetails(id);
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

  async function handleSaveResponses(newResponses: QuotationFormData) {
    if (!quotation) return;

    try {
      const newBreakdown = calculatePrice(newResponses);
      const newTotal = newBreakdown.estimatedTotal;

      const { error } = await supabase
        .from('quotations')
        .update({
          responses: newResponses,
          total_price: newTotal,
          price_breakdown: newBreakdown
        })
        .eq('id', id);

      if (error) throw error;

      setQuotation(prev => prev ? { ...prev, responses: newResponses, total_price: newTotal, price_breakdown: newBreakdown } : null);
      setShowResponseEditor(false);
    } catch (err) {
      console.error('Update responses error:', err);
      alert('Error al actualizar las respuestas');
    }
  }

  // ─── Manual price editing ──────────────────────────────────
  // Recompute totals from a draft breakdown (subtotal = base + items,
  // total = subtotal + per-guest items). Mirrors pricing-engine output.
  function recalcDraft(draft: PriceBreakdown): PriceBreakdown {
    const subtotal = (draft.basePrice || 0) + (draft.items || []).reduce((s, i) => s + (i.amount || 0), 0);
    const perGuestTotal = (draft.perGuestItems || []).reduce((s, i) => s + (i.estimatedTotal || 0), 0);
    return { ...draft, subtotal, perGuestTotal, estimatedTotal: subtotal + perGuestTotal };
  }

  function startEditPrices() {
    if (!breakdown) return;
    // Deep clone so edits don't mutate the live quotation until saved
    setPriceDraft(JSON.parse(JSON.stringify(breakdown)) as PriceBreakdown);
    setEditingPrices(true);
  }

  function cancelEditPrices() {
    setEditingPrices(false);
    setPriceDraft(null);
  }

  function updateDraftBase(value: number) {
    setPriceDraft(prev => prev ? recalcDraft({ ...prev, basePrice: value }) : prev);
  }

  function updateDraftItem(index: number, value: number) {
    setPriceDraft(prev => {
      if (!prev) return prev;
      const items = prev.items.map((it, i) => i === index ? { ...it, amount: value } : it);
      return recalcDraft({ ...prev, items });
    });
  }

  function updateDraftPerGuest(index: number, pricePerGuest: number) {
    setPriceDraft(prev => {
      if (!prev) return prev;
      const perGuestItems = prev.perGuestItems.map((it, i) =>
        i === index ? { ...it, pricePerGuest, estimatedTotal: pricePerGuest * (it.estimatedGuests || 0) } : it
      );
      return recalcDraft({ ...prev, perGuestItems });
    });
  }

  async function savePrices() {
    if (!id || !priceDraft) return;
    try {
      setSavingPrices(true);
      const finalDraft = recalcDraft(priceDraft);
      const newTotal = finalDraft.estimatedTotal;
      const { error } = await supabase
        .from('quotations')
        .update({ price_breakdown: finalDraft, total_price: newTotal, document_outdated: true })
        .eq('id', id);
      if (error) throw error;
      setQuotation(prev => prev ? { ...prev, price_breakdown: finalDraft, total_price: newTotal, document_outdated: true } : null);
      setEditingPrices(false);
      setPriceDraft(null);
    } catch (err) {
      console.error('Update prices error:', err);
      alert('Error al actualizar los precios');
    } finally {
      setSavingPrices(false);
    }
  }

  // Build a readable response summary from the form data
  const responses = quotation.responses || {};
  const responseEntries: { label: string; value: string }[] = [];

  const labelMap: Record<string, string> = {
    // General
    contactName: 'Nombre',
    contactPhone: 'Teléfono',
    referralSource: 'Referencia',
    weddingPlannerName: 'Wedding Planner',
    eventType: 'Tipo de evento',
    eventDate: 'Fecha del evento',
    productType: 'Producto',
    invitationFormat: 'Formato',
    lang: 'Idioma',
    // PDF
    pdfMultipleEvents: 'Múltiples eventos',
    pdfSubEvents: 'Sub-eventos',
    pdfSameGuests: 'Mismos invitados',
    pdfMonogram: 'Monograma',
    pdfIllustrations: 'Ilustraciones',
    pdfGiftTable: 'Mesa de regalos',
    pdfExperienceTier: 'Mesa experiencias',
    pdfAdditionalInfo: 'Info adicional',
    pdfInfoCategories: 'Categorías info',
    pdfInfoOptionsCount: 'Opciones por cat.',
    pdfPersonalized: 'Rotulado',
    pdfRsvp: 'RSVP',
    pdfSending: 'Envío',
    pdfConfirmation: 'Confirmación',
    pdfGuestCountRange: 'Rango invitados',
    pdfAdditionalProducts: 'Extras adicionales',
    // Web
    webEventCount: 'Eventos web',
    webSeparatePages: 'Páginas separadas',
    webDomainType: 'Dominio',
    webMonogram: 'Monograma web',
    webDesignStyle: 'Estilo de diseño',
    webIllustrations: 'Ilustraciones',
    webRsvp: 'RSVP',
    webGiftTable: 'Mesa de regalos',
    webExperienceTier: 'Mesa experiencias',
    webAdditionalInfo: 'Info adicional',
    webInfoCategories: 'Categorías info',
    webInfoOptionsCount: 'Opciones por cat.',
    webSending: 'Envío',
    webConfirmation: 'Confirmación',
    webGuestCountRange: 'Rango invitados',
    webExtras: 'Extras web',
    webAdditionalProducts: 'Extras adicionales web',
    // STD
    stdFormat: 'Formato STD',
    stdDesignStyle: 'Estilo STD',
    stdSending: 'Envío STD',
    stdGuestCountRange: 'Rango invitados STD',
    // Units
    sendGuestCountRange: 'Rango envío',
    confirmGuestCountRange: 'Rango confirmación',
  };

  const productType = (quotation.product_type || '').toLowerCase();
  const format = (responses.invitationFormat || '').toLowerCase();

  // 1. First add general fields in specific order
  const generalKeys = ['contactName', 'contactPhone', 'referralSource', 'weddingPlannerName', 'eventType', 'eventDate', 'productType', 'invitationFormat'];
  generalKeys.forEach(key => {
    const val = responses[key as keyof typeof responses];
    if (val) {
      responseEntries.push({ 
        label: labelMap[key] || key, 
        value: key === 'eventDate' ? formatDate(val as string) : String(val) 
      });
    }
  });

  // 2. Add product-specific fields
  Object.entries(responses).forEach(([key, value]) => {
    // Skip general fields already added
    if (generalKeys.includes(key) || key === 'lang') return;

    // Filter by relevance to avoid duplicates (pdf vs web vs std)
    if (productType.includes('invitacion_digital')) {
      if (format === 'pdf_interactivo' && key.startsWith('web')) return;
      if (format === 'pagina_web' && key.startsWith('pdf')) return;
      if (key.startsWith('std')) return;
    } else if (productType.includes('save_the_date')) {
      if (key.startsWith('pdf') || key.startsWith('web')) return;
    } else if (productType.includes('envio')) {
       if (key.startsWith('pdf') || key.startsWith('web') || key.startsWith('std') || key.startsWith('confirm')) return;
    } else if (productType.includes('confirm')) {
       if (key.startsWith('pdf') || key.startsWith('web') || key.startsWith('std') || key.startsWith('send')) return;
    }

    // Skip technical/formatting fields
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;

    const displayValue = Array.isArray(value) 
      ? value.join(', ') 
      : (typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value));

    responseEntries.push({ 
      label: labelMap[key] || key, 
      value: displayValue 
    });
  });

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
              <div style={{ display: 'flex', alignItems: 'center' }}><span style={{ color: 'var(--text-muted)', marginRight: 4 }}>Teléfono:</span> {quotation.client?.phone} <WhatsappButton phone={quotation.client?.phone} /></div>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="heading-sm" style={{ margin: 0 }}>📋 Respuestas del formulario</h3>
              <button 
                className="btn btn-ghost btn-xs" 
                style={{ color: 'var(--color-primary-deep)', border: '1px solid currentColor' }}
                onClick={() => setShowResponseEditor(true)}
              >
                Editar
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {responseEntries.map((entry, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{entry.label}</span>
                  <span style={{ fontWeight: 500, textTransform: 'capitalize', textAlign: 'right' }}>{entry.value.replace(/(\d)_(\d)/g, '$1-$2').replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Price + Payments + Drive */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          {/* Price Breakdown */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="heading-sm" style={{ margin: 0 }}>💰 Desglose de precio</h3>
              {!editingPrices && breakdown && (
                <button
                  className="btn btn-ghost btn-xs no-print"
                  style={{ color: 'var(--color-primary-deep)', border: '1px solid currentColor' }}
                  onClick={startEditPrices}
                >
                  Editar precios
                </button>
              )}
            </div>

            {editingPrices && priceDraft ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', gap: 8 }}>
                  <span>{priceDraft.baseLabel?.es || 'Base'}</span>
                  <input
                    type="number"
                    className="input-field"
                    value={priceDraft.basePrice}
                    onChange={(e) => updateDraftBase(Number(e.target.value) || 0)}
                    style={{ width: 110, textAlign: 'right', fontSize: 'var(--text-sm)', padding: '4px 8px' }}
                  />
                </div>

                {priceDraft.items?.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', gap: 8 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{item.label.es}</span>
                    <input
                      type="number"
                      className="input-field"
                      value={item.amount}
                      onChange={(e) => updateDraftItem(i, Number(e.target.value) || 0)}
                      style={{ width: 110, textAlign: 'right', fontSize: 'var(--text-sm)', padding: '4px 8px' }}
                    />
                  </div>
                ))}

                {priceDraft.perGuestItems?.map((item, i) => (
                  <div key={`pg-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-sm)', gap: 8 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {item.label.es} <span style={{ color: 'var(--text-muted)' }}>($/invitado × {item.estimatedGuests} = {formatCurrency(item.estimatedTotal)})</span>
                    </span>
                    <input
                      type="number"
                      className="input-field"
                      value={item.pricePerGuest}
                      onChange={(e) => updateDraftPerGuest(i, Number(e.target.value) || 0)}
                      style={{ width: 110, textAlign: 'right', fontSize: 'var(--text-sm)', padding: '4px 8px' }}
                    />
                  </div>
                ))}

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', marginTop: 8, fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                  <span>Total estimado</span>
                  <span style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary-deep)' }}>
                    {formatCurrency(priceDraft.estimatedTotal)}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-primary btn-sm" onClick={savePrices} disabled={savingPrices}>
                    {savingPrices ? 'Guardando...' : 'Guardar precios'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={cancelEditPrices} disabled={savingPrices}>Cancelar</button>
                </div>
                <div className="step-note" style={{ marginTop: 8 }}>
                  Tras guardar, regenera el documento para reflejar los nuevos precios en el PDF. Editar las respuestas del formulario recalculará los precios y descartará estos ajustes.
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
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

                {/* 0. Outdated warning — prices changed since last generation */}
                {quotation.document_outdated && (quotation.document_pdf_url || quotation.drive_document_url) && (
                  <div style={{ background: '#FFFBE6', border: '1px solid #FFE58F', borderRadius: 8, padding: 12 }}>
                    <p style={{ margin: 0, color: '#AD6800', fontSize: 'var(--text-sm)', fontWeight: 600 }}>⚠️ Falta regenerar</p>
                    <p style={{ margin: '4px 0 0 0', color: '#AD6800', fontSize: 'var(--text-xs)' }}>
                      Los precios cambiaron desde la última generación. El documento actual no refleja los nuevos precios.
                    </p>
                  </div>
                )}

                {/* 1. Status Messages */}
                {quotation.document_status === 'generating' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-primary-deep)', padding: '4px 0', justifyContent: 'center' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>⏳ Generando en Google Drive...</span>
                  </div>
                )}

                {quotation.document_status === 'failed' && (
                  <div style={{ background: '#FFF1F0', border: '1px solid #FFA39E', borderRadius: 8, padding: 12 }}>
                    <p style={{ margin: 0, color: '#CF1322', fontSize: 'var(--text-sm)', fontWeight: 600 }}>Error al generar</p>
                    <p style={{ margin: '4px 0 0 0', color: '#CF1322', fontSize: 'var(--text-xs)' }}>{quotation.document_error}</p>
                  </div>
                )}

                {/* 2. Available Links */}
                {(quotation.document_pdf_url || quotation.drive_document_url) && (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {quotation.document_pdf_url && (
                      <a href={quotation.document_pdf_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
                        Descargar Cotización (PDF)
                      </a>
                    )}
                    {quotation.drive_document_url && (
                      <a href={quotation.drive_document_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
                        Abrir Presentación (Drive) ↗
                      </a>
                    )}
                  </div>
                )}

                {/* 3. Permanent Regeneration Button */}
                <div style={{ marginTop: 4 }}>
                  <button 
                    className="btn btn-ghost btn-sm" 
                    onClick={generateGoogleDocument}
                    disabled={generatingDoc}
                    style={{ width: '100%', justifyContent: 'center', border: '1px dashed var(--border-default)' }}
                  >
                    {generatingDoc ? 'Procesando...' : (quotation.document_pdf_url ? '🔄 Regenerar PPTX y PDF' : '✨ Generar PPTX y PDF')}
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditingDriveUrl(true)} style={{ opacity: 0.6 }}>
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

            {/* Suggested Payments 70/30 */}
            <div style={{ background: 'rgba(187, 235, 232, 0.05)', padding: 12, borderRadius: 8, border: '1px dashed var(--border-subtle)', marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600 }}>PAGOS SUGERIDOS (70% / 30%)</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                <span>Anticipo (70%):</span>
                <span style={{ fontWeight: 600 }}>{formatCurrency(quotation.total_price * 0.7)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginTop: 4 }}>
                <span>Entrega (30%):</span>
                <span style={{ fontWeight: 600 }}>{formatCurrency(quotation.total_price * 0.3)}</span>
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

      {showResponseEditor && quotation && (
        <ResponseEditor
          initialData={quotation.responses}
          onSave={handleSaveResponses}
          onClose={() => setShowResponseEditor(false)}
        />
      )}
    </div>
  </div>
  );
}
