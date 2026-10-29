import { SCREEN_ELEMENTS, type EventScreens } from './events-types';

/** La página pública corre dentro del iframe de vista previa de Diseño. */
export const IS_PREVIEW = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1';

export type PreviewScreen = keyof EventScreens;

/**
 * Atributos que marcan un elemento editable en la vista previa (data-el="welcome.title").
 * Fuera de la vista previa no agrega nada, así la página pública no cambia.
 */
export function previewEl(screen: PreviewScreen, key: string): Record<string, string> {
  if (!IS_PREVIEW) return {};
  const def = SCREEN_ELEMENTS[screen]?.find(e => e.key === key);
  return { 'data-el': `${screen}.${key}`, 'data-el-label': def?.label ?? key };
}
