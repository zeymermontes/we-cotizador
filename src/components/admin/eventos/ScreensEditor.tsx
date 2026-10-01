import { useState } from 'react';
import type { EventRow, EventScreens, EventLanguage, ScreenCopy, ElementStyle } from '../../../lib/events-types';
import { LANGUAGE_LABEL, SCREEN_ELEMENTS } from '../../../lib/events-types';

interface Props {
  event: EventRow;
  onSave: (screens: EventScreens) => Promise<boolean>;
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
    setSaving(true);
    await onSave(screens);
    setSaving(false);
  }

  return (
    <form className="section-card" onSubmit={save}>
      <h3>Textos de pantallas</h3>
      <p className="section-hint">
        Desmarca un elemento para ocultarlo y ajusta su tamaño en píxeles; vacío usa el tamaño de siempre. Textos vacíos usan el texto por defecto. Puedes usar <code>{'{{evento}}'}</code> y, en el mensaje de enviado, <code>{'{{nombre}}'}</code>.
      </p>

      {SCREENS.map(sc => (
        <div key={sc.key} style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{sc.label}</div>
          <div className="text-muted text-xs" style={{ marginBottom: 8 }}>{sc.hint}</div>
          <div className="screen-elements">
            <div className="screen-el-head"><span>Ver</span><span>Elemento</span><span>Texto</span><span>Tamaño</span></div>
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
                    {el.hint && <small>{el.hint}</small>}
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
                  <div className="screen-el-size">
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
                    <span>px</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="modal-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Guardando...' : 'Guardar textos'}</button>
      </div>
    </form>
  );
}
