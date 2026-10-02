import type { CSSProperties } from 'react';
// Tipos del producto "Registro de eventos" (ver supabase/migrations/008_eventos_base.sql)

export type ProfileRole = 'super' | 'event_admin';

export interface Profile {
  id: string;
  role: ProfileRole;
  full_name: string | null;
  email: string | null;
}

export type EventStatus = 'draft' | 'published' | 'closed' | 'archived';
export type EventLanguage = 'es' | 'en';
/** Los administradores entran siempre con correo y contraseña. */
export type LoginMethod = 'password';
export type MemberRole = 'owner' | 'admin' | 'viewer';

/** Texto por idioma. Si el evento es bilingüe, ambas claves vienen llenas. */
export type Localized = Partial<Record<EventLanguage, string>>;

export interface EventBranding {
  logo_url?: string | null;
  background_url?: string | null;
  primary?: string;
  /** Texto del botón principal (por defecto, el color de texto) */
  button_text?: string | null;
  background?: string;
  surface?: string;
  text?: string;
  font_display?: string;
  font_body?: string;
  button_radius?: number;
}

export const DEFAULT_BRANDING: Required<EventBranding> = {
  logo_url: null,
  background_url: null,
  primary: '#BBEBE8',
  button_text: null,
  background: '#f0eeeb',
  surface: '#ffffff',
  text: '#1a1a1a',
  font_display: 'Playfair Display',
  font_body: 'Inter',
  button_radius: 12,
};

export const FONT_OPTIONS = [
  'Playfair Display',
  'Caudex',
  'Cinzel',
  'EB Garamond',
  'Cormorant Garamond',
  'DM Serif Display',
  'Inter',
  'DM Sans',
  'Montserrat',
  'Poppins',
  'Lora',
] as const;

/** Ajuste visual de un elemento de pantalla. Todo opcional: lo que falta usa el estilo del branding. */
export interface ElementStyle {
  show?: boolean;
  /** px; alto para imágenes e iconos */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** color hex; vacío usa el color de texto del branding */
  color?: string;
  /** opacidad 0–100; vacío usa la del diseño */
  opacity?: number;
  /** familia: 'display' o 'body' del branding, o el nombre de una fuente de Google */
  font?: 'display' | 'body' | string;
  uppercase?: boolean;
}

export interface ScreenCopy {
  title?: Localized;
  subtitle?: Localized;
  button?: Localized;
  /** Por elemento (ver SCREEN_ELEMENTS): mostrar/ocultar y tamaño. */
  elements?: Record<string, ElementStyle>;
}

export interface ScreenElementDef {
  key: string;
  label: string;
  /** Campo de texto editable que representa, si lo hay. */
  text?: 'title' | 'subtitle' | 'button';
  placeholder?: Localized;
  /** Tamaño por defecto en px (alto para imágenes e iconos). */
  defaultSize: number;
  /** No se puede ocultar. */
  required?: boolean;
  hint?: string;
}

/** Todo lo que se dibuja en cada pantalla pública, en el orden en que aparece. */
export const SCREEN_ELEMENTS: Record<'welcome' | 'thank_you' | 'scanner' | 'footer', ScreenElementDef[]> = {
  welcome: [
    { key: 'logo', label: 'Logo', defaultSize: 72, hint: 'alto' },
    { key: 'title', label: 'Título', text: 'title', placeholder: { es: 'Regístrate a {{evento}}', en: 'Register for {{evento}}' }, defaultSize: 36 },
    { key: 'date', label: 'Fecha del evento', defaultSize: 14, hint: 'se toma de Ajustes generales' },
    { key: 'venue', label: 'Lugar', defaultSize: 14, hint: 'se toma de Ajustes generales' },
    { key: 'subtitle', label: 'Subtítulo', text: 'subtitle', placeholder: { es: 'Te tomará menos de un minuto.', en: 'It takes less than a minute.' }, defaultSize: 16 },
    { key: 'button', label: 'Botón', text: 'button', placeholder: { es: 'Comenzar', en: 'Start' }, defaultSize: 16, required: true },
    { key: 'hint', label: 'Pista "presiona Enter"', defaultSize: 12 },
  ],
  thank_you: [
    { key: 'check', label: 'Palomita', defaultSize: 64 },
    { key: 'title', label: 'Título', text: 'title', placeholder: { es: '¡Listo, {{nombre}}!', en: 'All set, {{nombre}}!' }, defaultSize: 32 },
    { key: 'subtitle', label: 'Mensaje', text: 'subtitle', placeholder: { es: 'Recibirás tu invitación por correo o WhatsApp.', en: 'You will receive your invitation by email or WhatsApp.' }, defaultSize: 16 },
  ],
  scanner: [
    { key: 'title', label: 'Título', text: 'title', placeholder: { es: 'Control de acceso', en: 'Check-in' }, defaultSize: 26 },
    { key: 'name', label: 'Nombre del evento', defaultSize: 16 },
    { key: 'subtitle', label: 'Instrucción', text: 'subtitle', placeholder: { es: 'Escanea el QR de la invitación.', en: 'Scan the invitation QR.' }, defaultSize: 16 },
  ],
  footer: [
    { key: 'powered', label: 'Powered by We.Page', defaultSize: 11, hint: 'al pie de todas las pantallas' },
  ],
};

/** Fuentes de Google que piden los elementos de las pantallas (además de las del branding). */
export function screenFonts(screens: EventScreens | null | undefined): string[] {
  const out = new Set<string>();
  for (const copy of Object.values(screens ?? {})) {
    for (const st of Object.values((copy as ScreenCopy | undefined)?.elements ?? {})) {
      if (st.font && st.font !== 'display' && st.font !== 'body') out.add(st.font);
    }
  }
  return [...out];
}

/** Pila CSS para una familia. Caudex dibuja ¿ y ¡ colgando bajo la línea base, así que se
 *  antepone 'Caudex Punct' (dos glifos, subidos; ver index.css) solo para esos caracteres. */
export function fontStack(name: string | undefined): string {
  if (!name) return '';
  return name === 'Caudex' ? "'Caudex Punct', 'Caudex'" : `'${name}'`;
}

export function elementShown(copy: ScreenCopy | undefined, key: string): boolean {
  return copy?.elements?.[key]?.show !== false;
}

/** Tamaño configurado en px, o undefined para usar el del CSS. */
export function elementSize(copy: ScreenCopy | undefined, key: string): number | undefined {
  const s = copy?.elements?.[key]?.size;
  return typeof s === 'number' && s > 0 ? s : undefined;
}

/** Estilo inline para un elemento de texto (tamaño, peso, cursiva, subrayado, color, familia). */
export function elementFont(copy: ScreenCopy | undefined, key: string): CSSProperties | undefined {
  const st = copy?.elements?.[key];
  if (!st) return undefined;
  const out: CSSProperties = {};
  const size = elementSize(copy, key);
  if (size) out.fontSize = size;
  if (st.bold !== undefined) out.fontWeight = st.bold ? 700 : 400;
  if (st.italic) out.fontStyle = 'italic';
  if (st.underline) out.textDecoration = 'underline';
  if (st.uppercase) out.textTransform = 'uppercase';
  if (st.color && /^#[0-9a-f]{6}$/i.test(st.color)) out.color = st.color;
  if (typeof st.opacity === 'number' && st.opacity >= 0 && st.opacity <= 100) out.opacity = st.opacity / 100;
  if (st.font === 'display') out.fontFamily = "var(--brand-font-display, 'Playfair Display'), serif";
  else if (st.font === 'body') out.fontFamily = "var(--brand-font-body, 'Inter'), sans-serif";
  else if (st.font) out.fontFamily = `${fontStack(st.font)}, sans-serif`;
  return Object.keys(out).length ? out : undefined;
}

export interface EventScreens {
  welcome?: ScreenCopy;
  thank_you?: ScreenCopy;
  scanner?: ScreenCopy;
  /** Pie común a todas las pantallas públicas (solo elementos, sin textos). */
  footer?: ScreenCopy;
}

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  event_date: string | null;
  timezone: string;
  venue: string | null;
  status: EventStatus;
  languages: EventLanguage[];
  default_language: EventLanguage;
  login_method: LoginMethod;
  capacity: number | null;
  registration_closes_at: string | null;
  branding: EventBranding;
  screens: EventScreens;
  sender_name: string | null;
  reply_to: string | null;
  // Ver InvitationConfig en lib/invitations.ts
  invitation_config: object | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Lo que ve el público (vista events_public). */
export type PublicEvent = Pick<
  EventRow,
  | 'id' | 'slug' | 'name' | 'description' | 'event_date' | 'timezone' | 'venue'
  | 'status' | 'languages' | 'default_language' | 'registration_closes_at'
  | 'branding' | 'screens'
>;

export interface EventMember {
  event_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  email: string | null;
  full_name: string | null;
  profile_role: ProfileRole;
}

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  closed: 'Cerrado',
  archived: 'Archivado',
};

/** Reusa los badges que ya existen en index.css */
export const EVENT_STATUS_BADGE: Record<EventStatus, string> = {
  draft: 'badge-pendiente',
  published: 'badge-aceptada',
  closed: 'badge-enviada',
  archived: 'badge-rechazada',
};

export const LANGUAGE_LABEL: Record<EventLanguage, string> = {
  es: 'Español',
  en: 'English',
};

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function pickLocalized(value: Localized | undefined, lang: EventLanguage, fallback = ''): string {
  if (!value) return fallback;
  return value[lang] || value.es || value.en || fallback;
}
