// Un solo build sirve tres sitios. El hostname decide cuál se monta:
//   registro.we.page/<slug>  → formulario público de registro
//   acceso.we.page/<slug>    → scanner de asistencia (con PIN)
//   cualquier otro           → cotizador + admin (lo de siempre)
//
// En local no hay subdominios, así que el modo admin también monta
// /r/<slug> y /s/<slug> para poder probar los sitios públicos.

export type AppMode = 'admin' | 'registro' | 'acceso';

const REGISTRO_HOST = import.meta.env.VITE_REGISTRO_HOST || 'registro.we.page';
const ACCESO_HOST = import.meta.env.VITE_ACCESO_HOST || 'acceso.we.page';

export function getAppMode(): AppMode {
  const forced = import.meta.env.VITE_APP_MODE as AppMode | undefined;
  if (forced === 'registro' || forced === 'acceso') return forced;

  const host = window.location.hostname.toLowerCase();
  if (host === REGISTRO_HOST || host.startsWith('registro.')) return 'registro';
  if (host === ACCESO_HOST || host.startsWith('acceso.')) return 'acceso';
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
