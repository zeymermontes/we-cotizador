import { getAppMode } from './host';

// Las pantallas de eventos se montan en dos sitios: el admin global
// (/admin/eventos) y el panel de clientes (panel.we.page/eventos; en local
// /panel/eventos). Estas funciones evitan rutas fijas en los componentes.

function inLocalPanel(): boolean {
  return getAppMode() === 'admin' && window.location.pathname.startsWith('/panel');
}

/** Lista de eventos del sitio actual; un evento es `${eventsBase()}/${id}`. */
export function eventsBase(): string {
  if (getAppMode() === 'panel') return '/eventos';
  if (inLocalPanel()) return '/panel/eventos';
  return '/admin/eventos';
}

export function eventPath(id: string, tab?: string): string {
  return `${eventsBase()}/${id}${tab ? `/${tab}` : ''}`;
}

/** Pantalla de login del sitio actual. */
export function loginPath(): string {
  if (getAppMode() === 'panel') return '/login';
  if (inLocalPanel()) return '/panel/login';
  return '/admin/login';
}
