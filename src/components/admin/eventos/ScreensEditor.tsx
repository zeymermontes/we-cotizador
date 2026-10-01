import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventRow, EventScreens, EventLanguage, ScreenCopy, ElementStyle } from '../../../lib/events-types';
import { LANGUAGE_LABEL, SCREEN_ELEMENTS, FONT_OPTIONS } from '../../../lib/events-types';

interface Props {
  event: EventRow;
  /** Si falta, el guardado lo hace quien lo contiene (pestaña Diseño). */
  onSave?: (screens: EventScreens) => Promise<boolean>;
  /** Cada cambio sin guardar, para la vista previa en vivo. */
  onChange?: (screens: EventScreens) => void;
}

type ScreenKey = keyof EventScreens;
type FieldKey = 'title' | 'subtitle' | 'button';

const SCREENS: { key: ScreenKey; label: string; hint: string }[] = [
  { key: 'welcome', label: 'Bienvenida del formulario', hint: 'Primera pantalla que ve el invitado antes de empezar.' },
  { key: 'thank_you', label: 'Mensaje de enviado', hint: 'Se muestra al terminar el registro.' },
  { key: 'scanner', label: 'Pantalla del scanner', hint: 'Lo que ve el staff en la puerta al escribir el PIN.' },
];

export default function ScreensEditor({ event, onSave, onChange }: Props) {
  const [screens, setScreens] = useState<EventScreens>(event.screens ?? {});
  const [saving, setSaving] = useState(false);
  const langs: EventLanguage[] = event.languages;

  const update = (next: EventScreens) => { setScreens(next); onChange?.(next); };

  function setText(screen: ScreenKey, field: FieldKey, lang: EventLanguage, value: string) {
    update({
      ...screens,
      [screen]: {
        ...(screens[screen] ?? {}),
        [field]: { ...((screens[screen]?.[field]) ?? {}), [lang]: value },
      },
    });
  }

  function setElement(screen: ScreenKey, key: string, patch: ElementStyle) {
    const copy: ScreenCopy = screens[screen] ?? {};
    const elements = { ...(copy.elements ?? {}), [key]: { ...(copy.elements?.[key] ?? {}), ...patch } };
    update({ ...screens, [screen]: { ...copy, elements } });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!onSave) return;
    setSaving(true);
    await onSave(screens);
    setSaving(false);
  }

  return (
    <form className="section-card" onSubmit={save}>
      <h3>Textos de pantallas</h3>
      <p className="section-hint">
        Desmarca un elemento para ocultarlo. En Estilo: negritas, cursiva, subrayado, mayúsculas, color (clic derecho lo quita), familia, opacidad en % y tamaño en píxeles; lo que dejes vacío usa el branding. Textos vacíos usan el texto por defecto. Puedes usar <code>{'{{evento}}'}</code> y, en el mensaje de enviado, <code>{'{{nombre}}'}</code>.
      </p>

      {SCREENS.map(sc => (
        <div key={sc.key} style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{sc.label}</div>
          <div className="text-muted text-xs" style={{ marginBottom: 8 }}>{sc.hint}</div>
          <div className="screen-elements">
            <div className="screen-el-head"><span>Ver</span><span>Elemento</span><span>Texto</span><span>Estilo</span></div>
            {SCREEN_ELEMENTS[sc.key].map(el => {
              const style = screens[sc.key]?.elements?.[el.key];
              const shown = style?.show !== false;
              return (
                <div key={el.key} className={`screen-el-row ${shown ? '' : 'hidden'}`}>
                  <label className="screen-el-toggle" title={el.required ? 'Este elemento siempre se muestra' : shown ? 'Ocultar' : 'Mostrar'}>
                    <input
                      type="checkbox"
                      checked={shown}
                      disabled={el.required}
                      onChange={e => setElement(sc.key, el.key, { show: e.target.checked })}
                    />
                  </label>
                  <div className="screen-el-label">
                    {el.label}
                    {el.hint && <small>{el.hint === 'se toma de Ajustes generales' ? <>se toma de <Link to={`/admin/eventos/${event.id}/ajustes`}>Ajustes</Link></> : el.hint}</small>}
                  </div>
                  <div className="screen-el-text">
                    {el.text ? langs.map(lang => (
                      <input
                        key={lang}
                        className="input-field"
                        value={screens[sc.key]?.[el.text!]?.[lang] ?? ''}
                        onChange={e => setText(sc.key, el.text!, lang, e.target.value)}
                        placeholder={`${langs.length > 1 ? LANGUAGE_LABEL[lang] + ': ' : ''}${el.placeholder?.[lang] ?? ''}`}
                        disabled={!shown}
                      />
                    )) : <span className="text-muted text-xs">automático</span>}
                  </div>
                  <div className="screen-el-style">
                    {el.text || !['logo', 'check'].includes(el.key) ? (
                      <>
                        <div className="seg">
                          <button type="button" className={`seg-btn ${style?.bold ? 'active' : ''}`} title="Negritas" disabled={!shown} onClick={() => setElement(sc.key, el.key, { bold: style?.bold ? undefined : true })}><b>B</b></button>
                          <button type="button" className={`seg-btn ${style?.italic ? 'active' : ''}`} title="Cursiva" disabled={!shown} onClick={() => setElement(sc.key, el.key, { italic: style?.italic ? undefined : true })}><i>I</i></button>
                          <button type="button" className={`seg-btn ${style?.underline ? 'active' : ''}`} title="Subrayado" disabled={!shown} onClick={() => setElement(sc.key, el.key, { underline: style?.underline ? undefined : true })}><u>S</u></button>
                          <button type="button" className={`seg-btn ${style?.uppercase ? 'active' : ''}`} title="Mayúsculas" disabled={!shown} onClick={() => setElement(sc.key, el.key, { uppercase: style?.uppercase ? undefined : true })}>AA</button>
                        </div>
                        <label className={`screen-el-color ${style?.color ? '' : 'auto'}`} title={style?.color ? 'Color del texto (clic derecho para quitar)' : 'Color del texto: el del branding'} onContextMenu={e => { e.preventDefault(); setElement(sc.key, el.key, { color: undefined }); }}>
                          <input type="color" value={style?.color ?? '#000000'} disabled={!shown} onChange={e => setElement(sc.key, el.key, { color: e.target.value })} />
                          <span style={{ background: style?.color ?? 'transparent' }} />
                        </label>
                        <select className="glass-select screen-el-font" value={style?.font ?? ''} disabled={!shown} title="Familia tipográfica" style={style?.font && style.font !== 'display' && style.font !== 'body' ? { fontFamily: `'${style.font}', sans-serif` } : undefined} onChange={e => setElement(sc.key, el.key, { font: (e.target.value || undefined) as ElementStyle['font'] })}>
                          <option value="">Auto</option>
                          <option value="display">Títulos ({event.branding?.font_display ?? 'branding'})</option>
                          <option value="body">Texto ({event.branding?.font_body ?? 'branding'})</option>
                          <optgroup label="Otra fuente">
                            {FONT_OPTIONS.map(f => <option key={f} value={f} style={{ fontFamily: `'${f}', sans-serif` }}>{f}</option>)}
                          </optgroup>
                        </select>
                      </>
                    ) : null}
                    <span className="screen-el-size" title="Opacidad (100 = sólido)">
                      <input
                        className="input-field"
                        type="number"
                        min={0}
                        max={100}
                        value={style?.opacity ?? ''}
                        placeholder="100"
                        onChange={e => setElement(sc.key, el.key, { opacity: e.target.value === '' ? undefined : Math.max(0, Math.min(100, Number(e.target.value))) })}
                        disabled={!shown}
                      />
                      %
                    </span>
                    <span className="screen-el-size" title="Tamaño en píxeles">
                      <input
                        className="input-field"
                        type="number"
                        min={8}
                        max={240}
                        value={style?.size ?? ''}
                        placeholder={String(el.defaultSize)}
                        onChange={e => setElement(sc.key, el.key, { size: e.target.value === '' ? undefined : Number(e.target.value) })}
                        disabled={!shown}
                      />
                      px
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {onSave && (
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Guardando...' : 'Guardar textos'}</button>
        </div>
      )}
    </form>
  );
}
