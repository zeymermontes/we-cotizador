// Un solo build sirve cuatro sitios. El hostname decide cuál se monta:
//   registro.we.page/<slug>  → formulario público de registro
//   acceso.we.page/<slug>    → scanner de asistencia (con PIN)
//   panel.we.page            → panel de eventos para los clientes
//   cualquier otro           → cotizador + admin global del equipo
//
// En local no hay subdominios, así que el modo admin también monta
// /r/<slug>, /s/<slug> y /panel/* para poder probar los otros sitios.

export type AppMode = 'admin' | 'registro' | 'acceso' | 'panel';

const REGISTRO_HOST = import.meta.env.VITE_REGISTRO_HOST || 'registro.we.page';
const ACCESO_HOST = import.meta.env.VITE_ACCESO_HOST || 'acceso.we.page';
const PANEL_HOST = import.meta.env.VITE_PANEL_HOST || 'panel.we.page';

export function getAppMode(): AppMode {
  const forced = import.meta.env.VITE_APP_MODE as AppMode | undefined;
  if (forced === 'registro' || forced === 'acceso' || forced === 'panel') return forced;

  const host = window.location.hostname.toLowerCase();
  if (host === REGISTRO_HOST || host.startsWith('registro.')) return 'registro';
  if (host === ACCESO_HOST || host.startsWith('acceso.')) return 'acceso';
  if (host === PANEL_HOST || host.startsWith('panel.')) return 'panel';
  return 'admin';
}

function isLocal(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local');
}

/** URLs públicas de un evento, para copiar desde el admin. */
export function publicUrls(slug: string): { registro: string; acceso: string } {
  if (isLocal()) {
    const base = window.location.origin;
    return { registro: `${base}/r/${slug}`, acceso: `${base}/s/${slug}` };
  }
  return {
    registro: `https://${REGISTRO_HOST}/${slug}`,
    acceso: `https://${ACCESO_HOST}/${slug}`,
  };
}

/** Raíz del panel de clientes (sitio aparte; en local, /panel). */
export function panelUrl(): string {
  return isLocal() ? `${window.location.origin}/panel` : `https://${PANEL_HOST}`;
}
