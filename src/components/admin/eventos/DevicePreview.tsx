import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventBranding, EventScreens, EventLanguage } from '../../../lib/events-types';
import { LANGUAGE_LABEL } from '../../../lib/events-types';
import { publicUrls } from '../../../lib/host';

type Device = 'mobile' | 'desktop';
type Stage = 'welcome' | 'done';

const DEVICES: Record<Device, { w: number; h: number; label: string }> = {
  mobile: { w: 390, h: 780, label: 'Móvil' },
  desktop: { w: 1280, h: 800, label: 'Escritorio' },
};

interface Props {
  slug: string;
  languages: EventLanguage[];
  branding: EventBranding | null | undefined;
  screens: EventScreens | null | undefined;
}

/**
 * Vista previa en vivo de la página pública. Carga la página real en un iframe
 * (/r/<slug>?preview=1) y le manda por postMessage el branding y los textos
 * tal como están en los editores, aunque no se hayan guardado.
 */
export default function DevicePreview({ slug, languages, branding, screens }: Props) {
  const [device, setDevice] = useState<Device>('mobile');
  const [stage, setStage] = useState<Stage>('welcome');
  const [lang, setLang] = useState<EventLanguage>(languages[0] ?? 'es');
  const [scale, setScale] = useState(1);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // Siempre la misma app y el mismo origen: así el iframe comparte la sesión del admin
  // y puede enseñar eventos en borrador. El enlace "Abrir" sí va a la URL pública.
  const src = `${window.location.origin}/r/${slug}?preview=1`;
  const openUrl = publicUrls(slug).registro;

  const payload = useMemo(
    () => ({ type: 'we-preview', branding: branding ?? undefined, screens: screens ?? undefined, stage, lang }),
    [branding, screens, stage, lang],
  );
  const send = () => frameRef.current?.contentWindow?.postMessage(payload, '*');

  // El iframe avisa cuando está listo; a partir de ahí cada cambio se reenvía.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === frameRef.current?.contentWindow && e.data?.type === 'we-preview-ready') setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (ready) frameRef.current?.contentWindow?.postMessage(payload, '*');
  }, [ready, payload]);

  // El escritorio se dibuja a 1280 px y se escala para caber en la columna.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const { w, h } = DEVICES[device];
      // Cabe a lo ancho de la columna y a lo alto de la ventana (barra y pista aparte).
      const availableW = el.clientWidth;
      const availableH = window.innerHeight - 150;
      setScale(Math.min(1, availableW / w, Math.max(0.3, availableH / h)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [device]);

  const { w, h } = DEVICES[device];

  return (
    <aside className="device-preview">
      <div className="device-preview-bar">
        <div className="seg">
          {(Object.keys(DEVICES) as Device[]).map(d => (
            <button key={d} type="button" className={`seg-btn ${device === d ? 'active' : ''}`} onClick={() => setDevice(d)}>
              {d === 'mobile' ? '📱' : '🖥️'} {DEVICES[d].label}
            </button>
          ))}
        </div>
        <div className="seg">
          <button type="button" className={`seg-btn ${stage === 'welcome' ? 'active' : ''}`} onClick={() => setStage('welcome')}>Bienvenida</button>
          <button type="button" className={`seg-btn ${stage === 'done' ? 'active' : ''}`} onClick={() => setStage('done')}>Gracias</button>
        </div>
        {languages.length > 1 && (
          <div className="seg">
            {languages.map(l => (
              <button key={l} type="button" className={`seg-btn ${lang === l ? 'active' : ''}`} onClick={() => setLang(l)}>{LANGUAGE_LABEL[l]}</button>
            ))}
          </div>
        )}
        <a className="btn btn-ghost btn-xs" href={openUrl} target="_blank" rel="noreferrer">Abrir ↗</a>
      </div>

      <div className={`device-stage ${device}`} ref={stageRef}>
        <div className={`device-frame ${device}`} style={{ width: w * scale, height: h * scale }}>
          <iframe
            ref={frameRef}
            title="Vista previa"
            src={src}
            style={{ width: w, height: h, transform: `scale(${scale})` }}
            onLoad={send}
          />
        </div>
      </div>
      <p className="device-preview-hint">Refleja los cambios aunque no los hayas guardado. Puedes recorrer el formulario; en vista previa no se envía nada.</p>
    </aside>
  );
}
