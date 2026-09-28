import { useState } from 'react';
import type { EventRow, EventScreens, EventLanguage, ScreenCopy, Localized } from '../../../lib/events-types';
import { LANGUAGE_LABEL } from '../../../lib/events-types';

interface Props {
  event: EventRow;
  onSave: (screens: EventScreens) => Promise<boolean>;
}

type ScreenKey = keyof EventScreens;
type FieldKey = keyof ScreenCopy;

const SCREENS: { key: ScreenKey; label: string; hint: string; fields: { key: FieldKey; label: string; placeholder: Localized }[] }[] = [
  {
    key: 'welcome',
    label: 'Bienvenida del formulario',
    hint: 'Primera pantalla que ve el invitado antes de empezar.',
    fields: [
      { key: 'title', label: 'Título', placeholder: { es: 'Regístrate a {{evento}}', en: 'Register for {{evento}}' } },
      { key: 'subtitle', label: 'Subtítulo', placeholder: { es: 'Te tomará menos de un minuto.', en: 'It takes less than a minute.' } },
      { key: 'button', label: 'Botón', placeholder: { es: 'Comenzar', en: 'Start' } },
    ],
  },
  {
    key: 'thank_you',
    label: 'Mensaje de enviado',
    hint: 'Se muestra al terminar el registro.',
    fields: [
      { key: 'title', label: 'Título', placeholder: { es: '¡Listo, {{nombre}}!', en: 'All set, {{nombre}}!' } },
      { key: 'subtitle', label: 'Mensaje', placeholder: { es: 'Recibirás tu invitación por correo o WhatsApp.', en: 'You will receive your invitation by email or WhatsApp.' } },
    ],
  },
  {
    key: 'scanner',
    label: 'Pantalla del scanner',
    hint: 'Lo que ve el staff en la puerta.',
    fields: [
      { key: 'title', label: 'Título', placeholder: { es: 'Control de acceso', en: 'Check-in' } },
      { key: 'subtitle', label: 'Instrucción', placeholder: { es: 'Escanea el QR de la invitación.', en: 'Scan the invitation QR.' } },
    ],
  },
];

export default function ScreensEditor({ event, onSave }: Props) {
  const [screens, setScreens] = useState<EventScreens>(event.screens ?? {});
  const [saving, setSaving] = useState(false);
  const langs: EventLanguage[] = event.languages;

  function setText(screen: ScreenKey, field: FieldKey, lang: EventLanguage, value: string) {
    setScreens(prev => ({
      ...prev,
      [screen]: {
        ...(prev[screen] ?? {}),
        [field]: { ...((prev[screen]?.[field]) ?? {}), [lang]: value },
      },
    }));
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
        Déjalos vacíos para usar el texto por defecto. Puedes usar <code>{'{{evento}}'}</code> y, en el mensaje de enviado, <code>{'{{nombre}}'}</code>.
      </p>

      {SCREENS.map(s => (
        <div key={s.key} style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{s.label}</div>
          <div className="text-muted text-xs" style={{ marginBottom: 8 }}>{s.hint}</div>
          <div className="field-grid">
            {s.fields.map(f => (
              <div key={f.key} className="input-group">
                <label className="input-label">{f.label}</label>
                {langs.map(lang => (
                  <input
                    key={lang}
                    className="input-field"
                    style={{ marginBottom: langs.length > 1 ? 6 : 0 }}
                    value={screens[s.key]?.[f.key]?.[lang] ?? ''}
                    onChange={e => setText(s.key, f.key, lang, e.target.value)}
                    placeholder={`${langs.length > 1 ? LANGUAGE_LABEL[lang] + ': ' : ''}${f.placeholder[lang] ?? ''}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="modal-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Guardando...' : 'Guardar textos'}</button>
      </div>
    </form>
  );
}
