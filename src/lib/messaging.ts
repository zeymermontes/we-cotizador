// Tipos del módulo de comunicaciones (ver supabase/migrations/011_messaging.sql)
export * from '../../supabase/functions/_shared/messaging-core.ts';
import type { Localized } from './form-types';

export type MessageChannel = 'email' | 'whatsapp';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'failed' | 'exported';
export type AutomationTrigger = 'on_register' | 'on_waitlist' | 'on_selected' | 'on_invited' | 'on_confirmed' | 'reminder';

export interface MessageTemplate {
  id: string;
  event_id: string;
  channel: MessageChannel;
  name: string;
  subject: Localized;
  body: Localized;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  event_id: string;
  registration_id: string | null;
  channel: MessageChannel;
  template_id: string | null;
  trigger: string | null;
  to_address: string | null;
  subject: string | null;
  status: MessageStatus;
  provider_id: string | null;
  error: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Automation {
  id: string;
  event_id: string;
  trigger: AutomationTrigger;
  channel: 'email';
  template_id: string | null;
  enabled: boolean;
  days_before: number;
}

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  queued: 'En cola',
  sent: 'Enviado',
  delivered: 'Entregado',
  opened: 'Abierto',
  bounced: 'Rebotó',
  failed: 'Falló',
  exported: 'Exportado',
};

export const TRIGGER_INFO: { key: AutomationTrigger; label: string; hint: string }[] = [
  { key: 'on_register', label: 'Al registrarse', hint: 'Confirmación automática en cuanto el invitado envía el formulario.' },
  { key: 'on_waitlist', label: 'Al quedar en lista de espera', hint: 'Cuando el cupo ya está lleno.' },
  { key: 'on_selected', label: 'Al marcarlo como seleccionado', hint: 'Cuando el admin lo mueve a "Seleccionado".' },
  { key: 'on_invited', label: 'Al marcarlo como invitado', hint: 'Ideal para mandar la invitación con QR una vez generada.' },
  { key: 'on_confirmed', label: 'Al confirmar asistencia', hint: 'Cuando pasa a "Confirmado".' },
  { key: 'reminder', label: 'Recordatorio antes del evento', hint: 'Se manda a invitados y confirmados con correo, una sola vez.' },
];

export const TRIGGER_LABEL: Record<string, string> = Object.fromEntries([
  ...TRIGGER_INFO.map(t => [t.key, t.label]),
  ['manual', 'Manual'], ['test', 'Prueba'], ['export', 'Excel WhatsApp'],
]);
