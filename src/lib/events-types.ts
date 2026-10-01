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
export type LoginMethod = 'magic_link' | 'password';
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

export interface ScreenCopy {
  title?: Localized;
  subtitle?: Localized;
  button?: Localized;
}

export interface EventScreens {
  welcome?: ScreenCopy;
  thank_you?: ScreenCopy;
  scanner?: ScreenCopy;
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
