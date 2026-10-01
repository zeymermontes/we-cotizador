import { useState, useRef, useEffect } from 'react';
import type { EventRow, EventBranding } from '../../../lib/events-types';
import { DEFAULT_BRANDING, FONT_OPTIONS } from '../../../lib/events-types';
import { uploadEventImage, removeEventImage, formatBytes, type ImageKind, type ImageStage } from '../../../lib/images';

const STAGE_TEXT: Record<ImageStage, string> = { decode: 'Leyendo la imagen…', compress: 'Convirtiendo y comprimiendo…', upload: 'Subiendo…' };
const ACCEPT = 'image/*,.heic,.heif,.tif,.tiff,.avif';
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
        Se aplica al formulario de registro, a la pantalla de gracias y al scanner. Las imágenes se convierten a WebP y se comprimen solas antes de subir, sin importar su peso o formato (JPG, PNG, HEIC de iPhone, TIFF…).
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
            <ColorField label="Botón" value={b.primary} onChange={v => set('primary', v)} />
            <ColorField label="Texto del botón" value={b.button_text || b.text} onChange={v => set('button_text', v)} />
            <ColorField label="Fondo" value={b.background} onChange={v => set('background', v)} />
            <ColorField label="Tarjeta" value={b.surface} onChange={v => set('surface', v)} />
            <ColorField label="Texto" value={b.text} onChange={v => set('text', v)} />
          </div>

          <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
            <div className="input-group">
              <label className="input-label">Fuente de títulos</label>
              <FontSelect value={b.font_display} onChange={v => set('font_display', v)} />
            </div>
            <div className="input-group">
              <label className="input-label">Fuente de texto</label>
              <FontSelect value={b.font_body} onChange={v => set('font_body', v)} />
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
              <button type="button" className="branded-btn" style={{ background: b.primary, color: b.button_text || b.text, borderRadius: b.button_radius }}>
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

/** Lista de fuentes conocidas + cualquier familia de Google Fonts escrita a mano.
 *  Es un menú propio (no un <select>) para que cada opción se vea en su tipografía. */
function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = (FONT_OPTIONS as readonly string[]).includes(value);
  const [custom, setCustom] = useState(!known);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loadAll, setLoadAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items: string[] = [...FONT_OPTIONS, '__custom'];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    setLoadAll(true);
    setActive(Math.max(0, items.indexOf(value)));
    setOpen(true);
  };
  const pick = (v: string) => {
    setOpen(false);
    if (v === '__custom') setCustom(true);
    else onChange(v);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); }
  };

  if (custom) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input-field" value={value} onChange={e => onChange(e.target.value)} placeholder="Nombre en Google Fonts" style={{ fontFamily: value ? `'${value}', sans-serif` : undefined }} />
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setCustom(false); if (!known) onChange(FONT_OPTIONS[0]); }}>Lista</button>
      </div>
    );
  }

  return (
    <div className="font-select" ref={rootRef} onKeyDown={onKey}>
      {loadAll && <FontLoader fonts={[...FONT_OPTIONS]} />}
      <button
        type="button"
        className="glass-select font-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ fontFamily: `'${value}', sans-serif` }}
        onClick={() => (open ? setOpen(false) : show())}
      >
        {value}
      </button>
      {open && (
        <ul className="font-select-menu" role="listbox" ref={listRef} aria-activedescendant={`font-opt-${active}`}>
          {items.map((f, i) => {
            const isCustom = f === '__custom';
            return (
              <li
                key={f}
                id={`font-opt-${i}`}
                role="option"
                aria-selected={f === value}
                className={`font-select-option ${i === active ? 'active' : ''} ${f === value ? 'selected' : ''} ${isCustom ? 'custom' : ''}`}
                style={isCustom ? undefined : { fontFamily: `'${f}', sans-serif` }}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(f)}
              >
                <span className="font-select-check">{f === value ? '✓' : ''}</span>
                <span className="font-select-name">{isCustom ? 'Otra de Google Fonts…' : f}</span>
                {!isCustom && <span className="font-select-sample" aria-hidden>Aa Bb 123</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


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
  const [busy, setBusy] = useState<ImageStage | null>(null);
  const [over, setOver] = useState(false);
  const [meta, setMeta] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy('decode');
    onError('');
    try {
      const previous = value;
      const up = await uploadEventImage(eventId, kind, file, undefined, setBusy);
      onChange(up.url);
      setMeta(`${formatBytes(up.originalBytes)} → ${formatBytes(up.blob.size)}`);
      if (previous) removeEventImage(previous).catch(() => {});
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
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
        <input ref={inputRef} type="file" accept={ACCEPT} onChange={e => handle(e.target.files?.[0])} disabled={!!busy} />
        {busy ? (
          <span>{STAGE_TEXT[busy]}</span>
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
