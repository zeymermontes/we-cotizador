// ─────────────────────────────────────────────────────────────
// scanner-session — canjea el PIN del evento por un token de scanner.
//
// Body: { slug, pin, device? }
// Máximo 8 intentos fallidos por IP cada 15 minutos.
// El token dura 24 h y va en cada llamada a scanner-checkin.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_ATTEMPTS = 8;
const WINDOW_MIN = 15;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug ?? '').trim();
    const pin = String(body.pin ?? '').trim();
    const device = String(body.device ?? '').slice(0, 80) || null;
    if (!slug || !/^[0-9]{4,8}$/.test(pin)) return fail('bad_request', 'PIN inválido');

    const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown').split(',')[0].trim();
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: event } = await db.from('events')
      .select('id, slug, name, event_date, timezone, venue, status, languages, default_language, branding, screens')
      .eq('slug', slug).maybeSingle();
    if (!event || !['published', 'closed'].includes(event.status)) return fail('not_found', 'Evento no disponible');

    // Límite de intentos
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { count } = await db.from('scanner_pin_attempts').select('id', { count: 'exact', head: true })
      .eq('event_id', event.id).eq('ip', ip).eq('ok', false).gte('attempted_at', since);
    if ((count ?? 0) >= MAX_ATTEMPTS) return fail('too_many', `Demasiados intentos. Espera ${WINDOW_MIN} minutos.`);

    const { data: verified } = await db.rpc('verify_event_scanner_pin', { p_slug: slug, p_pin: pin });
    const ok = !!verified;
    await db.from('scanner_pin_attempts').insert({ event_id: event.id, ip, ok });
    if (!ok) return fail('wrong_pin', 'PIN incorrecto');

    const token = newToken();
    const { data: session, error } = await db.from('scanner_sessions')
      .insert({ event_id: event.id, token, device_label: device })
      .select('id, expires_at').single();
    if (error) return fail('db_error', error.message);

    return json({
      ok: true,
      token,
      expires_at: session.expires_at,
      event: { id: event.id, slug: event.slug, name: event.name, event_date: event.event_date, timezone: event.timezone, venue: event.venue, languages: event.languages, default_language: event.default_language, branding: event.branding, screens: event.screens },
    });
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});
