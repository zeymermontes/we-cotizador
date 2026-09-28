import { useState, useRef } from 'react';
import type { EventRow, EventBranding } from '../../../lib/events-types';
import { DEFAULT_BRANDING, FONT_OPTIONS } from '../../../lib/events-types';
import { uploadEventImage, removeEventImage, formatBytes, type ImageKind } from '../../../lib/images';
import { brandingStyle, fontsHref } from '../../../lib/branding';

interface Props {
  event: EventRow;
  onSave: (branding: EventBranding) => Promise<boolean>;
}

const HEX = /^#[0-9a-f]{6}$/i;

export default function BrandingEditor({ event, onSave }: Props) {
  const [b, setB] = useState<Required<EventBranding>>({ ...DEFAULT_BRANDING, ...event.branding });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof EventBranding>(key: K, value: Required<EventBranding>[K]) =>
    setB(prev => ({ ...prev, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave(b);
    setSaving(false);
  }

  return (
    <form className="section-card" onSubmit={save}>
      <h3>Branding</h3>
      <p className="section-hint">
        Se aplica al formulario de registro, a la pantalla de gracias y al scanner. Las imágenes se comprimen solas antes de subir.
      </p>

      {error && <div className="inline-alert error">{error}</div>}

      <div className="field-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div>
          <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <ImageField
              label="Logo"
              hint="PNG o SVG con fondo transparente"
              eventId={event.id}
              kind="logo"
              value={b.logo_url}
              onChange={(url) => set('logo_url', url)}
              onError={setError}
            />
            <ImageField
              label="Fondo"
              hint="Foto o textura, opcional"
              eventId={event.id}
              kind="background"
              value={b.background_url}
              onChange={(url) => set('background_url', url)}
              onError={setError}
            />
          </div>

          <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
            <ColorField label="Color principal" value={b.primary} onChange={v => set('primary', v)} />
            <ColorField label="Fondo" value={b.background} onChange={v => set('background', v)} />
            <ColorField label="Tarjeta" value={b.surface} onChange={v => set('surface', v)} />
            <ColorField label="Texto" value={b.text} onChange={v => set('text', v)} />
          </div>

          <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
            <div className="input-group">
              <label className="input-label">Fuente de títulos</label>
              <select className="glass-select" value={b.font_display} onChange={e => set('font_display', e.target.value)}>
                {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Fuente de texto</label>
              <select className="glass-select" value={b.font_body} onChange={e => set('font_body', e.target.value)}>
                {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div className="input-group" style={{ marginTop: 16 }}>
            <label className="input-label">Redondez de botones: {b.button_radius}px</label>
            <input type="range" min={0} max={32} value={b.button_radius} onChange={e => set('button_radius', Number(e.target.value))} style={{ width: '100%' }} />
          </div>
        </div>

        <div>
          <label className="input-label">Vista previa</label>
          <div
            className="brand-preview"
            style={{
              ...brandingStyle(b),
              background: b.background_url ? `url(${b.background_url}) center/cover` : b.background,
              fontFamily: `'${b.font_body}', sans-serif`,
              color: b.text,
            }}
          >
            <div className="brand-preview-card" style={{ background: b.surface }}>
              {b.logo_url && <img src={b.logo_url} alt="" className="branded-logo" />}
              <h2 style={{ fontFamily: `'${b.font_display}', serif`, fontWeight: 500, marginBottom: 6 }}>{event.name}</h2>
              <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>Regístrate para recibir tu invitación.</p>
              <button type="button" className="branded-btn" style={{ background: b.primary, color: b.text, borderRadius: b.button_radius }}>
                Comenzar →
              </button>
            </div>
          </div>
          <FontLoader fonts={[b.font_display, b.font_body]} />
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setB({ ...DEFAULT_BRANDING, logo_url: b.logo_url, background_url: b.background_url })}>
          Restablecer colores
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Guardando...' : 'Guardar branding'}</button>
      </div>
    </form>
  );
}

// ─── Campos ──────────────────────────────────────────────────

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <div className="color-field">
        <input type="color" value={HEX.test(value) ? value : '#000000'} onChange={e => { onChange(e.target.value); setText(e.target.value); }} />
        <input
          className="input-field"
          type="text"
          value={text}
          onChange={e => { setText(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value); }}
          onBlur={() => setText(value)}
          maxLength={7}
        />
      </div>
    </div>
  );
}

interface ImageFieldProps {
  label: string;
  hint: string;
  eventId: string;
  kind: ImageKind;
  value: string | null;
  onChange: (url: string | null) => void;
  onError: (msg: string) => void;
}

function ImageField({ label, hint, eventId, kind, value, onChange, onError }: ImageFieldProps) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [meta, setMeta] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    onError('');
    try {
      const previous = value;
      const up = await uploadEventImage(eventId, kind, file);
      onChange(up.url);
      setMeta(`${formatBytes(up.originalBytes)} → ${formatBytes(up.blob.size)}`);
      if (previous) removeEventImage(previous).catch(() => {});
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]); }}
      >
        <input ref={inputRef} type="file" accept="image/*" onChange={e => handle(e.target.files?.[0])} disabled={busy} />
        {busy ? (
          <span>Comprimiendo y subiendo...</span>
        ) : value ? (
          <>
            <img src={value} alt={label} />
            {meta && <span className="dropzone-meta">{meta}</span>}
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeEventImage(value).catch(() => {}); onChange(null); setMeta(''); }}
            >
              Quitar
            </button>
          </>
        ) : (
          <>
            <span>Arrastra o haz clic</span>
            <span className="dropzone-meta">{hint}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Carga las fuentes elegidas desde Google Fonts. */
export function FontLoader({ fonts }: { fonts: string[] }) {
  return <link rel="stylesheet" href={fontsHref(fonts)} />;
}
