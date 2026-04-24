import React, { useState } from 'react';
import { 
  GUEST_COUNT_RANGES,
} from '../../lib/quotation-types';
import type { 
  QuotationFormData, 
  ProductType, 
  InvitationFormat, 
  SubEvent,
  MonogramChoice,
  DesignStyle,
  GiftTableChoice,
  ExperienceTier,
  WebExtra,
  AdditionalProduct,
  StdFormat
} from '../../lib/quotation-types';

interface Props {
  initialData: QuotationFormData;
  onSave: (data: QuotationFormData) => void;
  onClose: () => void;
}

export default function ResponseEditor({ initialData, onSave, onClose }: Props) {
  const [formData, setFormData] = useState<QuotationFormData>(initialData);

  const updateField = (field: keyof QuotationFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleArrayItem = (field: keyof QuotationFormData, value: any) => {
    const current = (formData[field] as any[]) || [];
    const next = current.includes(value)
      ? current.filter(i => i !== value)
      : [...current, value];
    updateField(field, next);
  };

  const groupStyle: React.CSSProperties = {
    marginBottom: 20,
    padding: 16,
    background: 'var(--bg-card)',
    borderRadius: 16,
    border: '1px solid var(--border-subtle)',
    boxShadow: 'var(--shadow-sm)'
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '11px',
    color: 'var(--text-secondary)',
    marginBottom: 4,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    borderRadius: 10,
    color: 'var(--text-primary)',
    fontSize: '14px',
    marginBottom: 12,
    outline: 'none',
    transition: 'border-color 0.2s'
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 'var(--text-base)',
    fontWeight: 700,
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--color-primary-deep)',
    fontFamily: 'var(--font-display)'
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.3)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 16
    }}>
      <div className="glass-card animate-scale-in" style={{
        width: '100%',
        maxWidth: 720,
        maxHeight: '90vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        background: 'var(--bg-base)',
        border: '1px solid var(--border-default)',
        boxShadow: 'var(--shadow-lg)'
      }}>
        {/* Header */}
        <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color: 'var(--color-primary-deep)' }}>Editar Respuestas</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        {/* Form Body */}
        <div style={{ padding: 24, overflowY: 'auto', flex: 1, scrollbarWidth: 'thin' }}>
          
          {/* ─── Tipo de Producto ─── */}
          <div style={groupStyle}>
            <div style={sectionTitleStyle}>🎯 Producto Principal</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Producto</label>
                <select 
                  style={inputStyle} 
                  value={formData.productType || ''} 
                  onChange={e => updateField('productType', e.target.value as ProductType)}
                >
                  <option value="invitacion_digital">Invitación digital</option>
                  <option value="save_the_date">Save the Date</option>
                  <option value="envio_invitaciones">Únicamente Envío</option>
                  <option value="confirmaciones">Únicamente Confirmación</option>
                </select>
              </div>

              {formData.productType === 'invitacion_digital' && (
                <div>
                  <label style={labelStyle}>Formato</label>
                  <select 
                    style={inputStyle} 
                    value={formData.invitationFormat || ''} 
                    onChange={e => updateField('invitationFormat', e.target.value as InvitationFormat)}
                  >
                    <option value="pdf_interactivo">PDF Interactivo</option>
                    <option value="pagina_web">Página Web</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* ─── PDF Specifics ─── */}
          {formData.productType === 'invitacion_digital' && formData.invitationFormat === 'pdf_interactivo' && (
            <div style={groupStyle}>
              <div style={sectionTitleStyle}>📄 Detalles PDF</div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Múltiples Eventos</label>
                  <select style={inputStyle} value={String(formData.pdfMultipleEvents)} onChange={e => updateField('pdfMultipleEvents', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Mismos Invitados</label>
                  <select style={inputStyle} value={String(formData.pdfSameGuests)} onChange={e => updateField('pdfSameGuests', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Sub-Eventos</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['civil', 'welcome', 'tornaboda', 'otro'].map(sub => (
                    <button 
                      key={sub}
                      className={`badge ${formData.pdfSubEvents.includes(sub as SubEvent) ? 'badge-pagado' : 'badge-pendiente'}`}
                      onClick={() => toggleArrayItem('pdfSubEvents', sub)}
                      style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', fontSize: 11 }}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Monograma</label>
                  <select style={inputStyle} value={formData.pdfMonogram || ''} onChange={e => updateField('pdfMonogram', e.target.value as MonogramChoice)}>
                    <option value="yes">Sí</option>
                    <option value="no">No</option>
                    <option value="already_have">Ya tengo</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Ilustraciones</label>
                  <select style={inputStyle} value={String(formData.pdfIllustrations)} onChange={e => updateField('pdfIllustrations', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Mesa de Regalos</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['link_tienda', 'transferencia', 'mesa_experiencias', 'not_sure'].map(gift => (
                    <button 
                      key={gift}
                      className={`badge ${formData.pdfGiftTable.includes(gift as GiftTableChoice) ? 'badge-pagado' : 'badge-pendiente'}`}
                      onClick={() => toggleArrayItem('pdfGiftTable', gift)}
                      style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', fontSize: 11 }}
                    >
                      {gift.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {formData.pdfGiftTable.includes('mesa_experiencias') && (
                <div>
                  <label style={labelStyle}>Nivel Experiencias</label>
                  <select style={inputStyle} value={formData.pdfExperienceTier || ''} onChange={e => updateField('pdfExperienceTier', e.target.value as ExperienceTier)}>
                    <option value="essential_10">Esencial (10)</option>
                    <option value="intermediate_20">Intermedia (20)</option>
                    <option value="complete_30">Completa (30)</option>
                    <option value="full_30plus">Muy completa (30+)</option>
                  </select>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Personalizada (Boletos)</label>
                  <select style={inputStyle} value={String(formData.pdfPersonalized)} onChange={e => updateField('pdfPersonalized', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>RSVP</label>
                  <select style={inputStyle} value={String(formData.pdfRsvp)} onChange={e => updateField('pdfRsvp', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Servicio Envio</label>
                  <select style={inputStyle} value={String(formData.pdfSending)} onChange={e => updateField('pdfSending', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Servicio Confirmación</label>
                  <select style={inputStyle} value={String(formData.pdfConfirmation)} onChange={e => updateField('pdfConfirmation', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Rango Invitados</label>
                <select 
                  style={inputStyle} 
                  value={formData.pdfGuestCountRange || ''} 
                  onChange={e => updateField('pdfGuestCountRange', e.target.value)}
                >
                  {GUEST_COUNT_RANGES.map(r => (
                    <option key={r.label} value={r.label}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Extras Adicionales</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['save_the_date', 'pdf_adicional', 'pagina_web_adicional', 'our_moments', 'layout_mesas'].map(extra => (
                    <button 
                      key={extra}
                      className={`badge ${formData.pdfAdditionalProducts.includes(extra as AdditionalProduct) ? 'badge-pagado' : 'badge-pendiente'}`}
                      onClick={() => toggleArrayItem('pdfAdditionalProducts', extra)}
                      style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', fontSize: 11 }}
                    >
                      {extra.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── Web Specifics ─── */}
          {formData.productType === 'invitacion_digital' && formData.invitationFormat === 'pagina_web' && (
            <div style={groupStyle}>
              <div style={sectionTitleStyle}>🌐 Detalles Web</div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Cant. Eventos</label>
                  <input type="number" style={inputStyle} value={formData.webEventCount || 1} onChange={e => updateField('webEventCount', parseInt(e.target.value))} />
                </div>
                <div>
                  <label style={labelStyle}>Páginas Separadas</label>
                  <select style={inputStyle} value={String(formData.webSeparatePages)} onChange={e => updateField('webSeparatePages', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Dominio</label>
                  <select style={inputStyle} value={formData.webDomainType || ''} onChange={e => updateField('webDomainType', e.target.value)}>
                    <option value="generic">Genérico</option>
                    <option value="custom">Personalizado</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Monograma</label>
                  <select style={inputStyle} value={formData.webMonogram || ''} onChange={e => updateField('webMonogram', e.target.value as MonogramChoice)}>
                    <option value="yes">Sí</option>
                    <option value="no">No</option>
                    <option value="already_have">Ya tengo</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Estilo Diseño</label>
                <select style={inputStyle} value={formData.webDesignStyle || ''} onChange={e => updateField('webDesignStyle', e.target.value as DesignStyle)}>
                  <option value="photos">Fotos</option>
                  <option value="graphic">Gráfico</option>
                  <option value="mixed">Mixto</option>
                  <option value="unsure">No sé aún</option>
                </select>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Extras Web</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['bilingue', 'password', 'clima'].map(extra => (
                    <button 
                      key={extra}
                      className={`badge ${formData.webExtras.includes(extra as WebExtra) ? 'badge-pagado' : 'badge-pendiente'}`}
                      onClick={() => toggleArrayItem('webExtras', extra)}
                      style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', fontSize: 11 }}
                    >
                      {extra}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Servicio Envio</label>
                  <select style={inputStyle} value={String(formData.webSending)} onChange={e => updateField('webSending', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Servicio Confirmación</label>
                  <select style={inputStyle} value={String(formData.webConfirmation)} onChange={e => updateField('webConfirmation', e.target.value === 'true')}>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Rango Invitados</label>
                <select 
                  style={inputStyle} 
                  value={formData.webGuestCountRange || ''} 
                  onChange={e => updateField('webGuestCountRange', e.target.value)}
                >
                  {GUEST_COUNT_RANGES.map(r => (
                    <option key={r.label} value={r.label}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ─── Save the Date Specifics ─── */}
          {formData.productType === 'save_the_date' && (
            <div style={groupStyle}>
              <div style={sectionTitleStyle}>📅 Detalles STD</div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Formato</label>
                  <select style={inputStyle} value={formData.stdFormat || ''} onChange={e => updateField('stdFormat', e.target.value as StdFormat)}>
                    <option value="basico">Básico</option>
                    <option value="extendido">Extendido</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Estilo</label>
                  <select style={inputStyle} value={formData.stdDesignStyle || ''} onChange={e => updateField('stdDesignStyle', e.target.value as DesignStyle)}>
                    <option value="photos">Fotos</option>
                    <option value="graphic">Gráfico</option>
                    <option value="mixed">Mixto</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Servicio Envio</label>
                <select style={inputStyle} value={String(formData.stdSending)} onChange={e => updateField('stdSending', e.target.value === 'true')}>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Rango Invitados</label>
                <select 
                  style={inputStyle} 
                  value={formData.stdGuestCountRange || ''} 
                  onChange={e => updateField('stdGuestCountRange', e.target.value)}
                >
                  {GUEST_COUNT_RANGES.map(r => (
                    <option key={r.label} value={r.label}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ─── Envío / Confirmación Directa ─── */}
          {(formData.productType === 'envio_invitaciones' || formData.productType === 'confirmaciones') && (
            <div style={groupStyle}>
              <div style={sectionTitleStyle}>📲 Detalles Servicio Directo</div>
              
              <label style={labelStyle}>Rango {formData.productType === 'envio_invitaciones' ? 'Envío' : 'Confirmación'}</label>
              <select 
                style={inputStyle} 
                value={(formData.productType === 'envio_invitaciones' ? formData.sendGuestCountRange : formData.confirmGuestCountRange) || ''} 
                onChange={e => updateField(formData.productType === 'envio_invitaciones' ? 'sendGuestCountRange' : 'confirmGuestCountRange', e.target.value)}
              >
                {GUEST_COUNT_RANGES.map(r => (
                  <option key={r.label} value={r.label}>{r.label}</option>
                ))}
              </select>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding: '24px 28px', borderTop: '1px solid var(--border-default)', display: 'flex', justifyContent: 'flex-end', gap: 12, background: '#fff' }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '8px 24px' }}>Cancelar</button>
          <button onClick={() => onSave(formData)} className="btn btn-primary btn-sm" style={{ padding: '8px 32px' }}>Recalcular y Guardar</button>
        </div>
      </div>
    </div>
  );
}
