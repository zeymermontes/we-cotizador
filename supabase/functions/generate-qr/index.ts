// ─────────────────────────────────────────────────────────────
// generate-qr — asigna un token único a cada registro y sube su QR
// (PNG) al bucket event-assets. Solo super.
//
// Body: { event_id, registration_ids?: string[], all?: boolean, force?: boolean }
// Procesa hasta 150 por llamada y devuelve cuántos faltan; el
// navegador vuelve a llamar hasta que remaining = 0.
//
// Contenido del QR: "WE1:<token>". El scanner lo reconoce por el prefijo.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import QRCode from "npm:qrcode@1.5.3";
import { corsHeaders, json, fail } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BATCH = 150;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return fail('unauthorized', 'Sesión inválida');
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'super') return fail('forbidden', 'Solo el equipo puede generar QR');

    const body = await req.json().catch(() => ({}));
    const event_id = String(body.event_id ?? '');
    const ids: string[] = Array.isArray(body.registration_ids) ? body.registration_ids.map(String) : [];
    const all = body.all === true;
    const force = body.force === true;
    if (!event_id || (!all && ids.length === 0)) return fail('bad_request', 'Faltan datos');

    let q = db.from('registrations').select('id, name, qr_token, qr_url').eq('event_id', event_id).neq('status', 'cancelled');
    if (!all) q = q.in('id', ids);
    if (!force) q = q.is('qr_url', null);
    const { data: pending, error } = await q.order('created_at').limit(BATCH + 1);
    if (error) return fail('db_error', error.message);

    const rows = (pending ?? []).slice(0, BATCH);
    const remaining = Math.max(0, (pending?.length ?? 0) - rows.length);
    let done = 0;
    const errors: { id: string; message: string }[] = [];

    for (const r of rows) {
      try {
        const token = r.qr_token ?? newToken();
        const png = await QRCode.toBuffer(`WE1:${token}`, { type: 'png', width: 720, margin: 2, errorCorrectionLevel: 'M' });
        const path = `${event_id}/qr/${token}.png`;
        const { error: upErr } = await db.storage.from('event-assets').upload(path, new Uint8Array(png), {
          contentType: 'image/png', cacheControl: '31536000', upsert: true,
        });
        if (upErr) throw new Error(upErr.message);
        const { data: pub } = db.storage.from('event-assets').getPublicUrl(path);
        const { error: updErr } = await db.from('registrations').update({ qr_token: token, qr_url: pub.publicUrl }).eq('id', r.id);
        if (updErr) throw new Error(updErr.message);
        done++;
      } catch (e) {
        errors.push({ id: r.id, message: (e as Error).message });
      }
    }

    return json({ ok: true, done, failed: errors.length, remaining: remaining > 0 ? remaining : 0, errors: errors.slice(0, 10) });
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});
