import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventBranding, EventScreens, EventLanguage } from '../../../lib/events-types';
import { LANGUAGE_LABEL } from '../../../lib/events-types';
import { publicUrls } from '../../../lib/host';

type Device = 'mobile' | 'desktop';
export type PreviewStage = 'welcome' | 'done' | 'confirm';

/** Lo que enseña la vista previa; lo comparte con el editor de textos. */
export interface PreviewView {
  stage: PreviewStage;
  waitlist: boolean;
  lang: EventLanguage;
  mode: 'edit' | 'test';
  floating: boolean;
}

const DEVICES: Record<Device, { w: number; h: number; label: string }> = {
  mobile: { w: 390, h: 780, label: 'Móvil' },
  desktop: { w: 1280, h: 800, label: 'Escritorio' },
};

interface Props {
  slug: string;
  languages: EventLanguage[];
  branding: EventBranding | null | undefined;
  screens: EventScreens | null | undefined;
  view: PreviewView;
  onView: (patch: Partial<PreviewView>) => void;
  /** Elemento seleccionado ("welcome.title"). */
  selected: string | null;
  /** Se tocó un elemento en la vista previa; `top` es su altura en la ventana del admin. */
  onSelect: (el: string, anchor: { top: number; left: number }) => void;
}

/**
 * Vista previa en vivo de la página pública. Carga la página real en un iframe
 * (/r/<slug>?preview=1) y le manda por postMessage el branding y los textos
 * tal como están en los editores, aunque no se hayan guardado.
 */
export default function DevicePreview({ slug, languages, branding, screens, view, onView, selected, onSelect }: Props) {
  const [device, setDevice] = useState<Device>('mobile');
  const { stage, lang, waitlist, mode } = view;
  const [scale, setScale] = useState(1);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // Siempre la misma app y el mismo origen: así el iframe comparte la sesión del admin
  // y puede enseñar eventos en borrador. El enlace "Abrir" sí va a la URL pública.
  const src = `${window.location.origin}/r/${slug}?preview=1`;
  const openUrl = publicUrls(slug).registro;

  const payload = useMemo(
    () => ({ type: 'we-preview', branding: branding ?? undefined, screens: screens ?? undefined, stage, lang, waitlist, mode, selected }),
    [branding, screens, stage, lang, waitlist, mode, selected],
  );
  const send = () => frameRef.current?.contentWindow?.postMessage(payload, '*');

  // El iframe avisa cuando está listo y cuando se toca un elemento en modo edición.
  const scaleRef = useRef(1);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    scaleRef.current = scale;
    onSelectRef.current = onSelect;
  });
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || e.source !== frame.contentWindow || e.origin !== window.location.origin) return;
      if (e.data?.type === 'we-preview-ready') setReady(true);
      if (e.data?.type === 'we-preview-select' && typeof e.data.el === 'string') {
        const box = frame.getBoundingClientRect();
        const rect = e.data.rect as { top: number } | undefined;
        onSelectRef.current(e.data.el, { top: box.top + (rect?.top ?? 0) * scaleRef.current, left: box.left });
      }
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
          <button type="button" className={`seg-btn ${mode === 'edit' ? 'active' : ''}`} title="Toca un texto de la vista previa para editarlo" onClick={() => onView({ mode: 'edit' })}>✎ Editar</button>
          <button type="button" className={`seg-btn ${mode === 'test' ? 'active' : ''}`} title="Recorre la página como invitado" onClick={() => onView({ mode: 'test' })}>▶ Probar</button>
        </div>
        <div className="seg">
          <button type="button" className={`seg-btn ${stage === 'welcome' ? 'active' : ''}`} onClick={() => onView({ stage: 'welcome' })}>Bienvenida</button>
          <button type="button" className={`seg-btn ${stage === 'done' ? 'active' : ''}`} onClick={() => onView({ stage: 'done' })}>Gracias</button>
          <button type="button" className={`seg-btn ${stage === 'confirm' ? 'active' : ''}`} onClick={() => onView({ stage: 'confirm' })}>Confirmación</button>
        </div>
        {stage !== 'confirm' && (
          <div className="seg">
            <button type="button" className={`seg-btn ${!waitlist ? 'active' : ''}`} onClick={() => onView({ waitlist: false })}>Normal</button>
            <button type="button" className={`seg-btn ${waitlist ? 'active' : ''}`} title="Cómo se ve con el modo lista de espera activo" onClick={() => onView({ waitlist: true })}>Lista de espera</button>
          </div>
        )}
        {languages.length > 1 && (
          <div className="seg">
            {languages.map(l => (
              <button key={l} type="button" className={`seg-btn ${lang === l ? 'active' : ''}`} onClick={() => onView({ lang: l })}>{LANGUAGE_LABEL[l]}</button>
            ))}
          </div>
        )}
        {mode === 'edit' && (
          <label className="device-preview-check" title="Al tocar un texto, el editor se abre junto a la vista previa">
            <input type="checkbox" checked={view.floating} onChange={e => onView({ floating: e.target.checked })} /> Editor flotante
          </label>
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
      <p className="device-preview-hint">
        {mode === 'edit'
          ? 'Modo Editar: toca cualquier texto para editarlo. Los elementos ocultos se ven rayados.'
          : 'Modo Probar: recorre la página como invitado. En vista previa no se envía nada.'}
        {' '}Refleja los cambios aunque no los hayas guardado.
      </p>
    </aside>
  );
}
