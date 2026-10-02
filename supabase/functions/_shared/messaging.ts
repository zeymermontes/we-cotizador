// ─────────────────────────────────────────────────────────────
// Envío de correos (Resend) y automatizaciones. Solo servidor.
// ─────────────────────────────────────────────────────────────
import { normalizeSchema, type FormSchema, type Lang, text, type Localized } from './form-engine.ts';
import { buildVars, renderTemplate, textToHtml, emailHtml, htmlToText, type RegistrationLike } from './messaging-core.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_DOMAIN = Deno.env.get('RESEND_FROM_DOMAIN') ?? 'eventos.we.page';
const RESEND_FROM_LOCAL = Deno.env.get('RESEND_FROM_LOCAL') ?? 'hola';

export type Trigger = 'on_register' | 'on_waitlist' | 'on_selected' | 'on_invited' | 'on_confirmed' | 'reminder';

export interface TemplateRow {
  id: string;
  event_id: string;
  channel: 'email' | 'whatsapp';
  name: string;
  subject: Localized;
  body: Localized;
  attach_invitation?: boolean;
  attach_qr?: boolean;
}

export interface EventRowLite {
  id: string;
  slug: string;
  name: string;
  event_date: string | null;
  timezone: string;
  venue: string | null;
  sender_name: string | null;
  reply_to: string | null;
  branding: { logo_url?: string | null; primary?: string; background?: string; surface?: string; text?: string };
}

export interface RegistrationRow extends RegistrationLike {
  id: string;
  event_id: string;
  status: string;
}

export interface SendSummary {
  sent: number;
  skipped: number;
  failed: number;
  errors: { registration_id: string | null; message: string }[];
}

export interface EmailAttachment { filename: string; path: string }

/** URL que devuelve el archivo en crudo (Drive comparte páginas, no archivos). */
export function directFileUrl(url: string): string {
  const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/) ?? url.match(/[?&]id=([^&]+)/);
  if (m && url.includes('drive.google.com')) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}

const safeFile = (s: string) => (s || 'invitado').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'invitado';

/** Adjuntos que pide la plantilla y que el registro ya tiene. */
export function attachmentsFor(template: TemplateRow, r: RegistrationLike): EmailAttachment[] {
  const out: EmailAttachment[] = [];
  if (template.attach_invitation && r.invitation_url) {
    const ext = /\.pdf(\?|$)/i.test(r.invitation_url) || r.invitation_url.includes('drive.google.com') ? 'pdf' : /\.jpe?g(\?|$)/i.test(r.invitation_url) ? 'jpg' : 'png';
    out.push({ filename: `invitacion-${safeFile(r.name ?? '')}.${ext}`, path: directFileUrl(r.invitation_url) });
  }
  if (template.attach_qr && r.qr_url) out.push({ filename: `qr-${safeFile(r.name ?? '')}.png`, path: r.qr_url });
  return out;
}

export async function sendEmail(args: { from: string; to: string; subject: string; html: string; text: string; replyTo?: string | null; tags?: Record<string, string>; attachments?: EmailAttachment[] }): Promise<{ id: string }> {
  if (!RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY en los secretos de las funciones');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      reply_to: args.replyTo || undefined,
      attachments: args.attachments?.length ? args.attachments : undefined,
      tags: args.tags ? Object.entries(args.tags).map(([name, value]) => ({ name, value })) : undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Resend respondió ${res.status}`);
  return { id: String(data.id ?? '') };
}

function fromAddress(event: EventRowLite): string {
  const name = (event.sender_name || event.name).replace(/["<>]/g, '').trim();
  return `${name} <${RESEND_FROM_LOCAL}@${RESEND_FROM_DOMAIN}>`;
}

export async function loadPublishedSchema(db: Db, eventId: string): Promise<FormSchema | null> {
  const { data: f } = await db.from('event_forms').select('draft, published_version').eq('event_id', eventId).maybeSingle();
  if (!f) return null;
  if (f.published_version) {
    const { data: v } = await db.from('form_versions').select('schema').eq('event_id', eventId).eq('version', f.published_version).maybeSingle();
    if (v) return normalizeSchema(v.schema);
  }
  return normalizeSchema(f.draft);
}

/** Renderiza y manda la plantilla a cada registro con correo. Registra todo en `messages`. */
export async function sendTemplate(db: Db, args: {
  event: EventRowLite;
  template: TemplateRow;
  registrations: RegistrationRow[];
  schema: FormSchema | null;
  trigger: string;
  /** Si viene, se manda UNA sola vez a esta dirección (prueba). */
  testTo?: string;
}): Promise<SendSummary> {
  const { event, template, schema, trigger } = args;
  const summary: SendSummary = { sent: 0, skipped: 0, failed: 0, errors: [] };
  const from = fromAddress(event);
  const shell = {
    logoUrl: event.branding?.logo_url ?? null,
    primary: event.branding?.primary,
    background: event.branding?.background,
    surface: event.branding?.surface,
    textColor: event.branding?.text,
    eventName: event.name,
  };

  const targets = args.testTo ? args.registrations.slice(0, 1) : args.registrations;

  for (const r of targets) {
    const to = args.testTo ?? r.email;
    if (!to) { summary.skipped++; continue; }
    const lang: Lang = r.lang === 'en' ? 'en' : 'es';
    const vars = buildVars(event, r, schema, lang);
    const subject = renderTemplate(text(template.subject, lang), vars).trim() || event.name;
    const bodyTxt = renderTemplate(text(template.body, lang), vars);
    const html = emailHtml(textToHtml(bodyTxt), shell);

    const { data: row } = await db.from('messages').insert({
      event_id: event.id,
      registration_id: args.testTo ? null : r.id,
      channel: 'email',
      template_id: template.id,
      trigger,
      to_address: to,
      subject,
      status: 'queued',
    }).select('id').single();

    try {
      const { id } = await sendEmail({ from, to, subject, html, text: htmlToText(bodyTxt), replyTo: event.reply_to, tags: { event: event.slug, trigger }, attachments: attachmentsFor(template, r) });
      await db.from('messages').update({ status: 'sent', provider_id: id }).eq('id', row.id);
      summary.sent++;
    } catch (e) {
      const message = (e as Error).message;
      await db.from('messages').update({ status: 'failed', error: message }).eq('id', row.id);
      summary.failed++;
      summary.errors.push({ registration_id: r.id, message });
    }
  }
  return summary;
}

/** Ejecuta la automatización de un disparador para ciertos registros, si está activa. */
export async function runAutomation(db: Db, eventId: string, trigger: Trigger, registrationIds: string[]): Promise<SendSummary | null> {
  if (registrationIds.length === 0) return null;
  const { data: auto } = await db.from('automations')
    .select('id, template_id, enabled, days_before')
    .eq('event_id', eventId).eq('trigger', trigger).maybeSingle();
  if (!auto?.enabled || !auto.template_id) return null;

  const [{ data: event }, { data: template }, { data: regs }] = await Promise.all([
    db.from('events').select('id, slug, name, event_date, timezone, venue, sender_name, reply_to, branding').eq('id', eventId).maybeSingle(),
    db.from('message_templates').select('*').eq('id', auto.template_id).maybeSingle(),
    db.from('registrations').select('*').in('id', registrationIds),
  ]);
  if (!event || !template || !regs?.length) return null;
  const schema = await loadPublishedSchema(db, eventId);

  return sendTemplate(db, { event, template, registrations: regs, schema, trigger });
}
