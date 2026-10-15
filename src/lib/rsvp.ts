// Lista VIP: invitados que agrega el equipo y confirman por un enlace personal
// (registro.we.page/<slug>/c/<token>) sin llenar el formulario.
import { supabase } from './supabase';
import { publicUrls } from './host';
import type { EventRow, Localized } from './events-types';
import type { Registration } from './registrations';

export interface RsvpTexts {
  question?: Localized;
  yes_label?: Localized;
  no_label?: Localized;
  message_yes?: Localized;
  message_no?: Localized;
}

export interface RsvpConfig extends RsvpTexts {
  /** Al confirmar: generar QR e invitación (con plantilla en Drive) antes de pasar a "Confirmado". */
  auto_invitation?: boolean;
  /** Textos distintos para quienes se registraron por el formulario (si form_custom). */
  form_custom?: boolean;
  form?: RsvpTexts;
}

/** Textos que aplican a un invitado: los del formulario si están personalizados, si no los generales (VIP). */
export function rsvpTexts(cfg: RsvpConfig, vip: boolean): RsvpTexts {
  if (vip || !cfg.form_custom) return cfg;
  const f = cfg.form ?? {};
  return { question: f.question ?? cfg.question, yes_label: f.yes_label ?? cfg.yes_label, no_label: f.no_label ?? cfg.no_label, message_yes: f.message_yes ?? cfg.message_yes, message_no: f.message_no ?? cfg.message_no };
}

export const RSVP_DEFAULTS = {
  es: { question: 'Hola {{nombre}}, ¿nos acompañas?', yes: 'Asistiré', no: 'No asistiré', message_yes: '¡Gracias por confirmar! Te esperamos.', message_no: 'Gracias por avisarnos. Te vamos a extrañar.', change: 'Cambiar mi respuesta', people: 'personas', invalid: 'Este enlace no es válido o ya no está activo.', closed: 'Este evento ya no recibe confirmaciones.' },
  en: { question: 'Hi {{nombre}}, will you join us?', yes: 'I will attend', no: "I can't attend", message_yes: 'Thanks for confirming! See you there.', message_no: 'Thanks for letting us know. We will miss you.', change: 'Change my answer', people: 'people', invalid: 'This link is not valid or is no longer active.', closed: 'This event is no longer taking confirmations.' },
};

/** VIP = lo dio de alta el equipo por lista. Los del formulario también pueden tener enlace, pero no son VIP. */
export const isVip = (r: Pick<Registration, 'source'>) => r.source?.ref === 'vip';

/** Da enlace de confirmación a los registros que no lo tienen (VIP o del formulario). Devuelve cuántos se crearon. */
export async function ensureConfirmTokens(regs: Pick<Registration, 'id' | 'rsvp_token'>[]): Promise<number> {
  const missing = regs.filter(r => !r.rsvp_token);
  let n = 0;
  for (let i = 0; i < missing.length; i += 20) {
    const results = await Promise.all(missing.slice(i, i + 20).map(r => supabase.from('registrations').update({ rsvp_token: newRsvpToken() }).eq('id', r.id).is('rsvp_token', null)));
    for (const res of results) if (res.error) throw new Error(res.error.message);
    n += results.length;
  }
  return n;
}

export function newRsvpToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export const confirmUrl = (slug: string, token: string | null | undefined) => (token ? `${publicUrls(slug).registro}/c/${token}` : '');

export interface RsvpGuest { name: string | null; party_size: number; response: 'yes' | 'no' | null; status: string; vip?: boolean }
export interface RsvpInfo { ok: true; guest: RsvpGuest; config: RsvpConfig; event_status?: string }
export interface RsvpFail { ok: false; code: string; message: string }

export async function rsvpGet(token: string): Promise<RsvpInfo | RsvpFail> {
  const { data, error } = await supabase.functions.invoke<RsvpInfo | RsvpFail>('rsvp', { body: { action: 'get', token } });
  if (error || !data) return { ok: false, code: 'network', message: error?.message ?? 'Sin respuesta' };
  return data;
}

export async function rsvpAnswer(token: string, response: 'yes' | 'no'): Promise<RsvpInfo | RsvpFail> {
  const { data, error } = await supabase.functions.invoke<RsvpInfo | RsvpFail>('rsvp', { body: { action: 'answer', token, response } });
  if (error || !data) return { ok: false, code: 'network', message: error?.message ?? 'Sin respuesta' };
  return data;
}

// ─── Importar lista ──────────────────────────────────────────

export interface GuestRow { name: string; email: string | null; phone: string | null; party_size: number; company: string | null }

const looksEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const looksPhone = (s: string) => /^[+()\d\s.-]{7,}$/.test(s) && (s.match(/\d/g) ?? []).length >= 7;

/**
 * Lee lo que pegan desde Excel o un CSV: una persona por línea, columnas
 * separadas por tab, coma o punto y coma, en cualquier orden. Correo y
 * teléfono se reconocen por su forma; un número suelto de 1 a 20 son las
 * personas; el resto de texto, nombre y después empresa.
 */
export function parseGuestList(raw: string): GuestRow[] {
  const out: GuestRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim()).filter(Boolean);
    if (cells.length === 0) continue;
    const g: GuestRow = { name: '', email: null, phone: null, party_size: 1, company: null };
    const texts: string[] = [];
    for (const c of cells) {
      if (!g.email && looksEmail(c)) g.email = c.toLowerCase();
      else if (!g.phone && looksPhone(c)) g.phone = c.replace(/[^\d+]/g, '');
      else if (/^\d{1,2}$/.test(c) && Number(c) >= 1 && Number(c) <= 20) g.party_size = Number(c);
      else texts.push(c);
    }
    if (/^(nombre|name|correo|email|tel[eé]fono|phone)$/i.test(texts[0] ?? '')) continue; // encabezado
    g.name = texts[0] ?? '';
    g.company = texts[1] ?? null;
    if (!g.name && !g.email && !g.phone) continue;
    out.push(g);
  }
  return out;
}

/** Crea los VIP (estatus "Invitado") con su token; devuelve cuántos entraron. */
export async function createVipGuests(event: EventRow, rows: GuestRow[]): Promise<{ created: number; skipped: number }> {
  const { data: existing } = await supabase.from('registrations').select('email, phone').eq('event_id', event.id).neq('status', 'cancelled');
  const emails = new Set((existing ?? []).map(r => r.email).filter(Boolean));
  const phones = new Set((existing ?? []).map(r => r.phone).filter(Boolean));
  const fresh = rows.filter(g => !(g.email && emails.has(g.email)) && !(g.phone && phones.has(g.phone)));
  let created = 0;
  for (let i = 0; i < fresh.length; i += 100) {
    const batch = fresh.slice(i, i + 100).map(g => ({
      event_id: event.id, name: g.name || null, email: g.email, phone: g.phone, party_size: g.party_size, company: g.company,
      status: 'selected', lang: event.default_language, source: { ref: 'vip' }, tags: ['VIP'], rsvp_token: newRsvpToken(),
    }));
    const { data, error } = await supabase.from('registrations').insert(batch).select('id');
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map(r => r.id);
    // Pasar a "Invitado" en un segundo paso dispara el automatismo "al marcarlo como invitado" (enlace por correo)
    if (ids.length) await supabase.from('registrations').update({ status: 'invited' }).in('id', ids);
    created += ids.length;
  }
  return { created, skipped: rows.length - fresh.length };
}
