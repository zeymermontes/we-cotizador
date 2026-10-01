import type { CSSProperties } from 'react';
import { type EventBranding, DEFAULT_BRANDING } from './events-types';

/** Variables CSS que consumen .branded-page / .branded-btn. */
export function brandingStyle(b: EventBranding | undefined): CSSProperties {
  const m = { ...DEFAULT_BRANDING, ...(b ?? {}) };
  return {
    '--brand-primary': m.primary,
    '--brand-bg': m.background,
    '--brand-surface': m.surface,
    '--brand-text': m.text,
    '--brand-button-text': m.button_text || m.text,
    '--brand-font-display': `'${m.font_display}'`,
    '--brand-font-body': `'${m.font_body}'`,
    '--brand-radius': `${m.button_radius}px`,
  } as CSSProperties;
}

/** Hoja de Google Fonts para las familias elegidas. */
export function fontsHref(fonts: (string | undefined)[]): string {
  const fams = Array.from(new Set(fonts.filter((f): f is string => !!f)))
    .map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${fams}&display=swap`;
}
