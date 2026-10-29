import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventRow, EventScreens, EventLanguage, ScreenCopy, ElementStyle } from '../../../lib/events-types';
import { LANGUAGE_LABEL, SCREEN_ELEMENTS, FONT_OPTIONS, type ScreenElementDef } from '../../../lib/events-types';
import { eventPath } from '../../../lib/paths';
import type { PreviewStage, PreviewView } from './DevicePreview';

type ScreenKey = keyof EventScreens;
type FieldKey = NonNullable<ScreenElementDef['text']>;

interface Props {
  event: EventRow;
  /** Si falta, el guardado lo hace quien lo contiene (pestaña Diseño). */
  onSave?: (screens: EventScreens) => Promise<boolean>;
  /** Cada cambio sin guardar, para la vista previa en vivo. */
  onChange?: (screens: EventScreens) => void;
  /** Estado compartido con la vista previa (etapa, idioma, lista de espera). */
  view?: PreviewView;
  onView?: (patch: Partial<PreviewView>) => void;
  /** Elemento seleccionado ("welcome.title") y desde dónde. */
  selected?: { el: string; nonce: number; from: 'preview' | 'editor'; anchor?: { top: number; left: number } } | null;
  onSelect?: (el: string | null) => void;
}

interface Section { screen: ScreenKey; label: string; hint: string; stage: PreviewStage | null; variants?: boolean }

const SECTIONS: Section[] = [
  { screen: 'welcome', label: 'Bienvenida del formulario', hint: 'Primera pantalla que ve el invitado antes de empezar.', stage: 'welcome', variants: true },
  { screen: 'thank_you', label: 'Mensaje de enviado', hint: 'Se muestra al terminar el registro.', stage: 'done', variants: true },
  { screen: 'confirm', label: 'Confirmación por enlace', hint: 'Donde VIP y registrados responden "asistiré / no asistiré". Los textos se editan en Ajustes → Lista VIP.', stage: 'confirm' },
  { screen: 'scanner', label: 'Pantalla del scanner', hint: 'Lo que ve el staff en la puerta al escribir el PIN. No tiene vista previa aquí.', stage: null },
  { screen: 'footer', label: 'Pie de página', hint: 'Aparece abajo en todas las pantallas públicas.', stage: null },
];

const IMAGE_KEYS = new Set(['logo', 'check']);
const elKey = (screen: ScreenKey, key: string) => `${screen}.${key}`;

function hasStyle(st: ElementStyle | undefined): boolean {
  return !!st && Object.entries(st).some(([k, v]) => k !== 'show' && v !== undefined);
}

export default function ScreensEditor({ event, onSave, onChange, view, onView, selected, onSelect }: Props) {
  const [screens, setScreens] = useState<EventScreens>(event.screens ?? {});
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Set<ScreenKey>>(() => new Set(['welcome']));
  const [styleOpen, setStyleOpen] = useState<string | null>(null);
  const langs: EventLanguage[] = event.languages;
  const lang: EventLanguage = view?.lang && langs.includes(view.lang) ? view.lang : langs[0] ?? 'es';
  const waitlist = view?.waitlist ?? false;
  const rootRef = useRef<HTMLFormElement>(null);

  const update = (next: EventScreens) => { setScreens(next); onChange?.(next); };

  function setText(screen: ScreenKey, field: FieldKey, l: EventLanguage, value: string) {
    // Un texto vacío se borra: así "volver al texto por defecto" no deja cambios sin guardar.
    const texts: Partial<Record<EventLanguage, string>> = { ...((screens[screen]?.[field]) ?? {}), [l]: value };
    if (!value) delete texts[l];
    const copy: ScreenCopy = { ...(screens[screen] ?? {}), [field]: texts };
    if (!Object.keys(texts).length) delete copy[field];
    update({ ...screens, [screen]: copy });
  }

  function setElement(screen: ScreenKey, key: string, patch: ElementStyle) {
    const copy: ScreenCopy = screens[screen] ?? {};
    const merged: ElementStyle = { ...(copy.elements?.[key] ?? {}), ...patch };
    for (const k of Object.keys(merged) as (keyof ElementStyle)[]) if (merged[k] === undefined) delete merged[k];
    update({ ...screens, [screen]: { ...copy, elements: { ...(copy.elements ?? {}), [key]: merged } } });
  }

  function resetStyle(screen: ScreenKey, key: string) {
    const copy: ScreenCopy = screens[screen] ?? {};
    const show = copy.elements?.[key]?.show;
    update({ ...screens, [screen]: { ...copy, elements: { ...(copy.elements ?? {}), [key]: show === false ? { show } : {} } } });
  }

  const floating = !!(view?.floating && selected?.from === 'preview' && selected.anchor && selected.anchor.left > 420);
  // La sección del elemento tocado en la vista previa se abre sola.
  const forcedScreen = selected?.from === 'preview' && !floating ? selected.el.split('.')[0] : null;
  const isOpenSection = (screen: ScreenKey) => open.has(screen) || forcedScreen === screen;

  function toggleSection(sec: Section) {
    const next = new Set(open);
    if (isOpenSection(sec.screen)) {
      next.delete(sec.screen);
      if (forcedScreen === sec.screen) onSelect?.(null);
    }
    else {
      next.add(sec.screen);
      if (sec.stage) onView?.({ stage: sec.stage });
    }
    setOpen(next);
  }

  const visible = (el: ScreenElementDef) => !el.variant || el.variant === (waitlist ? 'waitlist' : 'normal');

  // Selección desde la vista previa: abre la sección, lleva la tarjeta a la vista y enfoca el texto.
  const lastNonce = useRef(0);
  useEffect(() => {
    if (!selected || selected.from !== 'preview' || selected.nonce === lastNonce.current) return;
    lastNonce.current = selected.nonce;
    if (floating) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = rootRef.current?.querySelector<HTMLElement>(`[data-card="${selected.el}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.classList.remove('flash');
      void card.offsetWidth;
      card.classList.add('flash');
      const ta = card.querySelector('textarea');
      if (ta && !ta.disabled) setTimeout(() => { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }, 300);
    }));
  }, [selected, floating]);

  // Cerrar el panel de estilo al hacer clic fuera.
  useEffect(() => {
    if (!styleOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.el-style-pop, .el-style-btn')) setStyleOpen(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [styleOpen]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!onSave) return;
    setSaving(true);
    await onSave(screens);
    setSaving(false);
  }

  const cardProps = (screen: ScreenKey, el: ScreenElementDef) => ({
    event, screen, el, lang, langs,
    copy: screens[screen],
    selected: selected?.el === elKey(screen, el.key),
    styleOpen: styleOpen === elKey(screen, el.key),
    onStyleOpen: (on: boolean) => setStyleOpen(on ? elKey(screen, el.key) : null),
    onLang: (l: EventLanguage) => onView?.({ lang: l }),
    onText: (l: EventLanguage, v: string) => el.text && setText(screen, el.text, l, v),
    onElement: (patch: ElementStyle) => setElement(screen, el.key, patch),
    onResetStyle: () => resetStyle(screen, el.key),
    onFocus: () => onSelect?.(elKey(screen, el.key)),
  });

  const floatDef = floating && selected ? (() => {
    const [screen, key] = selected.el.split('.') as [ScreenKey, string];
    const el = SCREEN_ELEMENTS[screen]?.find(e => e.key === key);
    return el ? { screen, el } : null;
  })() : null;

  return (
    <form className="section-card screens-editor" onSubmit={save} ref={rootRef}>
      <h3>Textos de pantallas</h3>
      <p className="section-hint">
        Escribe en grande; el estilo está en <b>Aa</b>. Un texto vacío usa el texto por defecto. También puedes tocar cualquier texto en la vista previa para editarlo.
      </p>

      {SECTIONS.map(sec => {
        const isOpen = isOpenSection(sec.screen);
        const els = SCREEN_ELEMENTS[sec.screen];
        const copy = screens[sec.screen];
        const edited = els.filter(el => hasStyle(copy?.elements?.[el.key]) || (el.text && Object.values(copy?.[el.text] ?? {}).some(Boolean))).length;
        return (
          <div key={sec.screen} className={`screen-acc ${isOpen ? 'open' : ''}`}>
            <div className="screen-acc-head">
              <button type="button" className="screen-acc-toggle" aria-expanded={isOpen} onClick={() => toggleSection(sec)}>
                <span className="screen-acc-chev">▸</span>
                <span className="screen-acc-title">{sec.label}</span>
                <span className="screen-acc-count">{els.length} elementos{edited ? ` · ${edited} editado${edited > 1 ? 's' : ''}` : ''}</span>
              </button>
              {isOpen && sec.variants && (
                <div className="seg screen-acc-variant">
                  <button type="button" className={`seg-btn ${!waitlist ? 'active' : ''}`} onClick={() => onView?.({ waitlist: false, ...(sec.stage ? { stage: sec.stage } : {}) })}>Normal</button>
                  <button type="button" className={`seg-btn ${waitlist ? 'active' : ''}`} onClick={() => onView?.({ waitlist: true, ...(sec.stage ? { stage: sec.stage } : {}) })}>Lista de espera</button>
                </div>
              )}
            </div>
            {isOpen && (
              <div className="screen-acc-body">
                <div className="text-muted text-xs">{sec.hint}</div>
                {sec.variants && waitlist && (
                  <div className="el-variant-banner">
                    Así se ve con <b>Modo lista de espera</b> activo (<Link to={eventPath(event.id, 'ajustes')}>Ajustes → Lista de espera manual</Link>). Lo puedes diseñar aunque esté apagado.
                  </div>
                )}
                {els.filter(visible).map(el => <ElementCard key={el.key} {...cardProps(sec.screen, el)} />)}
              </div>
            )}
          </div>
        );
      })}

      {floatDef && selected?.anchor && (
        <div
          className="el-float"
          style={{ top: Math.max(72, Math.min(window.innerHeight - 320, selected.anchor.top - 24)), left: Math.max(8, selected.anchor.left - 412) }}
        >
          <ElementCard {...cardProps(floatDef.screen, floatDef.el)} autoFocus />
          <div className="el-float-foot">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onSelect?.(null)}>Listo</button>
          </div>
        </div>
      )}

      {onSave && (
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Guardando...' : 'Guardar textos'}</button>
        </div>
      )}
    </form>
  );
}

// ─── Tarjeta de un elemento ───

interface CardProps {
  event: EventRow;
  screen: ScreenKey;
  el: ScreenElementDef;
  lang: EventLanguage;
  langs: EventLanguage[];
  copy: ScreenCopy | undefined;
  selected: boolean;
  styleOpen: boolean;
  autoFocus?: boolean;
  onStyleOpen: (on: boolean) => void;
  onLang: (l: EventLanguage) => void;
  onText: (l: EventLanguage, v: string) => void;
  onElement: (patch: ElementStyle) => void;
  onResetStyle: () => void;
  onFocus: () => void;
}

function autoValue(event: EventRow, screen: ScreenKey, el: ScreenElementDef): string {
  switch (el.key) {
    case 'logo': return event.branding?.logo_url ? 'Logo del branding' : 'Sin logo en el branding';
    case 'date': return event.event_date ? new Date(event.event_date).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Sin fecha';
    case 'venue': return event.venue || 'Sin lugar';
    case 'check': return 'Ícono ✓';
    case 'hint': return 'presiona Enter ↵';
    case 'name': return event.name;
    case 'title': return screen === 'confirm' ? event.name : '';
    case 'powered': return 'Powered by We.Page';
    default: return '';
  }
}

function ElementCard({ event, screen, el, lang, langs, copy, selected, styleOpen, autoFocus, onStyleOpen, onLang, onText, onElement, onResetStyle, onFocus }: CardProps) {
  const style = copy?.elements?.[el.key];
  const shown = style?.show !== false;
  const value = el.text ? copy?.[el.text]?.[lang] ?? '' : '';
  const custom = !!value;
  const other = langs.find(l => l !== lang);
  const otherMissing = !!other && !!el.text && custom && !copy?.[el.text]?.[other];
  const taRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(44, ta.scrollHeight + 2)}px`;
  }, [value, lang]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus, el.key]);

  function insert(token: string) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? start;
    onText(lang, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + token.length, start + token.length); });
  }

  const sourceLink = el.source === 'ajustes'
    ? <Link to={eventPath(event.id, 'ajustes')}>Editar en Ajustes ↗</Link>
    : el.source === 'vip'
      ? <Link to={eventPath(event.id, 'ajustes')}>Texto en Ajustes → Lista VIP ↗</Link>
      : el.source === 'branding' ? <span>arriba, en Branding</span> : null;

  return (
    <div
      className={`el-card ${selected ? 'sel' : ''} ${shown ? '' : 'off'}`}
      data-card={elKey(screen, el.key)}
      onMouseDown={e => { if (!(e.target as HTMLElement).closest('button, a, input, select')) onFocus(); }}
    >
      <div className="el-card-head">
        <span className="el-card-name">{el.label}</span>
        {el.text && <span className={`el-tag ${custom ? 'custom' : ''}`}>{custom ? 'Personalizado' : 'Por defecto'}</span>}
        {!el.text && <span className="el-card-value">{autoValue(event, screen, el)}{sourceLink && <> · {sourceLink}</>}</span>}
        <span style={{ flex: 1 }} />
        {el.text && !custom && shown && (
          <button type="button" className="btn-link-sm" onClick={() => { onText(lang, el.placeholder?.[lang] ?? ''); onFocus(); }}>Personalizar</button>
        )}
        {el.text && custom && (
          <button type="button" className="el-icon" title="Volver al texto por defecto" onClick={() => onText(lang, '')}>↺</button>
        )}
        {!el.required && (
          <button type="button" className="el-icon" title={shown ? 'Ocultar' : 'Mostrar'} aria-pressed={!shown} onClick={() => onElement({ show: shown ? false : undefined })}>
            {shown ? <EyeIcon /> : <EyeOffIcon />}
          </button>
        )}
        <span className="el-style-anchor">
          <button
            type="button"
            className={`el-icon el-style-btn ${hasStyle(style) ? 'dot' : ''}`}
            title="Estilo"
            aria-expanded={styleOpen}
            onClick={() => onStyleOpen(!styleOpen)}
          >
            {IMAGE_KEYS.has(el.key) ? '↕' : 'Aa'}
          </button>
          {styleOpen && <StylePopover event={event} el={el} style={style} onElement={onElement} onReset={onResetStyle} onClose={() => onStyleOpen(false)} />}
        </span>
      </div>

      {el.text && (
        <>
          {langs.length > 1 && (
            <div className="el-lang-tabs">
              {langs.map(l => (
                <button key={l} type="button" className={`${l === lang ? 'on' : ''} ${l !== lang && otherMissing ? 'warn' : ''}`} onClick={() => onLang(l)}>
                  {LANGUAGE_LABEL[l]}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            className="el-textarea"
            rows={1}
            value={value}
            disabled={!shown}
            placeholder={el.placeholder?.[lang] ?? ''}
            onChange={e => onText(lang, e.target.value)}
            onFocus={onFocus}
          />
          <div className="el-vars">
            Insertar:
            <button type="button" className="el-chip" onClick={() => insert('{{evento}}')} disabled={!shown}>{'{{evento}}'}</button>
            {screen === 'thank_you' && <button type="button" className="el-chip" onClick={() => insert('{{nombre}}')} disabled={!shown}>{'{{nombre}}'}</button>}
            <span>· **negritas** · [texto](https://enlace) · Enter = salto de línea</span>
          </div>
          {el.hint && <div className="el-hint">{el.hint}</div>}
        </>
      )}
    </div>
  );
}

// ─── Panel de estilo ───

function StylePopover({ event, el, style, onElement, onReset, onClose }: {
  event: EventRow;
  el: ScreenElementDef;
  style: ElementStyle | undefined;
  onElement: (patch: ElementStyle) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const image = IMAGE_KEYS.has(el.key);
  const size = style?.size ?? el.defaultSize;
  const opacity = style?.opacity ?? 100;
  const toggle = (k: 'bold' | 'italic' | 'underline' | 'uppercase') => onElement({ [k]: style?.[k] ? undefined : true });

  return (
    <div className="el-style-pop" role="dialog" aria-label={`Estilo de ${el.label}`}>
      <div className="el-style-title">{el.label}</div>
      {!image && (
        <>
          <label>Fuente</label>
          <select
            className="glass-select"
            value={style?.font ?? ''}
            style={style?.font && style.font !== 'display' && style.font !== 'body' ? { fontFamily: `'${style.font}', sans-serif` } : undefined}
            onChange={e => onElement({ font: e.target.value || undefined })}
          >
            <option value="">Auto</option>
            <option value="display">Títulos ({event.branding?.font_display ?? 'branding'})</option>
            <option value="body">Texto ({event.branding?.font_body ?? 'branding'})</option>
            <optgroup label="Otra fuente">
              {FONT_OPTIONS.map(f => <option key={f} value={f} style={{ fontFamily: `'${f}', sans-serif` }}>{f}</option>)}
            </optgroup>
          </select>
          <label>Formato y color</label>
          <div className="el-style-row">
            <div className="seg">
              <button type="button" className={`seg-btn ${style?.bold ? 'active' : ''}`} title="Negritas" onClick={() => toggle('bold')}><b>B</b></button>
              <button type="button" className={`seg-btn ${style?.italic ? 'active' : ''}`} title="Cursiva" onClick={() => toggle('italic')}><i>I</i></button>
              <button type="button" className={`seg-btn ${style?.underline ? 'active' : ''}`} title="Subrayado" onClick={() => toggle('underline')}><u>S</u></button>
              <button type="button" className={`seg-btn ${style?.uppercase ? 'active' : ''}`} title="Mayúsculas" onClick={() => toggle('uppercase')}>AA</button>
            </div>
            <label className={`screen-el-color ${style?.color ? '' : 'auto'}`} title="Color del texto">
              <input type="color" value={style?.color ?? '#000000'} onChange={e => onElement({ color: e.target.value })} />
              <span style={{ background: style?.color ?? 'transparent' }} />
            </label>
            {style?.color
              ? <button type="button" className="btn-link-sm" onClick={() => onElement({ color: undefined })}>✕ quitar</button>
              : <span className="text-muted text-xs">del branding</span>}
          </div>
        </>
      )}
      <label>{image ? 'Alto' : 'Tamaño'}</label>
      <div className="el-style-row">
        <input type="range" min={8} max={image ? 240 : 120} value={size} onChange={e => onElement({ size: Number(e.target.value) })} />
        <span className="el-style-num">{size} px</span>
      </div>
      <label>Opacidad</label>
      <div className="el-style-row">
        <input type="range" min={0} max={100} value={opacity} onChange={e => onElement({ opacity: Number(e.target.value) === 100 ? undefined : Number(e.target.value) })} />
        <span className="el-style-num">{opacity} %</span>
      </div>
      <div className="el-style-foot">
        <button type="button" className="btn-link-sm" onClick={onReset}>Restablecer</button>
        <button type="button" className="btn-link-sm" onClick={onClose}>Listo</button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" /><line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
