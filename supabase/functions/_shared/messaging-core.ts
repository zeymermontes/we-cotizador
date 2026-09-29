// ─────────────────────────────────────────────────────────────
// Render de plantillas de mensajes. TypeScript puro: lo usan el
// navegador (vista previa) y las edge functions (envío real).
// ─────────────────────────────────────────────────────────────
import { type FormSchema, type Answers, type Lang, answerToText, text } from './form-engine.ts';

export interface TemplateVariable {
  key: string;
  label: string;
  hint?: string;
}

/** Variables fijas disponibles en cualquier plantilla. */
export const BASE_VARIABLES: TemplateVariable[] = [
  { key: 'nombre', label: 'Nombre completo' },
  { key: 'primer_nombre', label: 'Primer nombre' },
  { key: 'correo', label: 'Correo' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'personas', label: 'Número de personas' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'evento', label: 'Nombre del evento' },
  { key: 'fecha', label: 'Fecha del evento' },
  { key: 'hora', label: 'Hora del evento' },
  { key: 'lugar', label: 'Lugar' },
  { key: 'qr_url', label: 'URL de la imagen del QR', hint: 'Vacío si aún no se genera' },
  { key: 'invitacion_url', label: 'URL del PDF de invitación', hint: 'Vacío si aún no se genera' },
];

export interface RegistrationLike {
  name: string | null;
  email: string | null;
  phone: string | null;
  party_size: number;
  company: string | null;
  lang: Lang;
  answers: Answers;
  qr_url?: string | null;
  invitation_url?: string | null;
}

export interface EventLike {
  name: string;
  event_date: string | null;
  timezone: string;
  venue: string | null;
}

/** Diccionario de variables para un registro concreto. */
export function buildVars(event: EventLike, r: RegistrationLike, schema: FormSchema | null, lang: Lang): Record<string, string> {
  const locale = lang === 'es' ? 'es-MX' : 'en-US';
  let fecha = '';
  let hora = '';
  if (event.event_date) {
    const d = new Date(event.event_date);
    try {
      fecha = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: event.timezone });
      hora = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: event.timezone });
    } catch {
      fecha = d.toLocaleDateString(locale);
      hora = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
  }
  const vars: Record<string, string> = {
    nombre: r.name ?? '',
    primer_nombre: (r.name ?? '').trim().split(/\s+/)[0] ?? '',
    correo: r.email ?? '',
    telefono: r.phone ?? '',
    personas: String(r.party_size ?? 1),
    empresa: r.company ?? '',
    evento: event.name,
    fecha,
    hora,
    lugar: event.venue ?? '',
    qr_url: r.qr_url ?? '',
    invitacion_url: r.invitation_url ?? '',
  };
  for (const q of schema?.questions ?? []) {
    if (q.type === 'statement') continue;
    vars[`q:${q.id}`] = answerToText(q, r.answers[q.id], lang);
  }
  return vars;
}

/** Sustituye {{variable}} (insensible a mayúsculas y espacios). */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  const lower = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  return (tpl ?? '').replace(/\{\{\s*([^{}]{1,80}?)\s*\}\}/g, (m, key: string) => {
    const v = lower.get(key.toLowerCase());
    return v === undefined ? m : v;
  });
}

export function variablesFor(schema: FormSchema | null, lang: Lang): TemplateVariable[] {
  const qs = (schema?.questions ?? []).filter(q => q.type !== 'statement');
  return [
    ...BASE_VARIABLES,
    ...qs.map(q => ({ key: `q:${q.id}`, label: text(q.title, lang) || (q.type === 'hidden' ? `oculto: ${q.key}` : 'Pregunta'), hint: 'Respuesta del invitado' })),
  ];
}

// ─── Texto → HTML de correo ───────────────────────────────────

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Convierte texto plano en párrafos con links. Soporta [texto](url) y URLs sueltas. */
export function textToHtml(body: string): string {
  const paragraphs = (body ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs.map(p => {
    let html = escapeHtml(p);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:inherit;font-weight:600">$1</a>');
    html = html.replace(/(^|[\s(])((https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" style="color:inherit">$2</a>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return `<p style="margin:0 0 16px;line-height:1.6">${html.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

export interface EmailShell {
  logoUrl?: string | null;
  primary?: string;
  background?: string;
  surface?: string;
  textColor?: string;
  eventName: string;
  footer?: string;
}

/** Envoltorio HTML sencillo y compatible con clientes de correo. */
export function emailHtml(bodyHtml: string, shell: EmailShell): string {
  const primary = shell.primary ?? '#BBEBE8';
  const bg = shell.background ?? '#f0eeeb';
  const surface = shell.surface ?? '#ffffff';
  const color = shell.textColor ?? '#1a1a1a';
  const logo = shell.logoUrl ? `<img src="${shell.logoUrl}" alt="" style="max-height:64px;max-width:200px;margin-bottom:20px">` : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:${bg};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${color}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:${surface};border-radius:16px;border-top:6px solid ${primary}">
<tr><td style="padding:32px 32px 8px;text-align:center">${logo}</td></tr>
<tr><td style="padding:8px 32px 32px;font-size:16px">${bodyHtml}</td></tr>
</table>
<p style="font-size:11px;color:${color};opacity:.5;margin-top:16px">${escapeHtml(shell.footer ?? shell.eventName)}</p>
</td></tr></table></body></html>`;
}

/** Versión texto plano (para clientes sin HTML). */
export function htmlToText(body: string): string {
  return (body ?? '').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1: $2').replace(/\*\*/g, '');
}
