// ─────────────────────────────────────────────────────────────
// rsvp — confirmación de asistencia de un invitado VIP por enlace.
// Público: la identidad es el token del enlace (registrations.rsvp_token).
//
// Body: { action: 'get' | 'answer', token, response?: 'yes' | 'no' }
//   get    → nombre del invitado, respuesta actual y textos configurados
//   answer → guarda la respuesta y mueve el estatus:
//            no  → cancelled
//            yes → confirmed. Si el evento tiene auto_invitation, antes se
//                  genera su QR y (con plantilla en Drive) su invitación, en
//                  segundo plano; el estatus cambia al terminar, para que el
//                  automatismo "al confirmar" salga ya con la invitación.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('JOBS_CRON_SECRET') ?? '';

const TOKEN_RE = /^[a-f0-9]{16,64}$/i;

async function callFn(name: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ...body, cron_secret: CRON_SECRET }),
  });
  return res.json().catch(() => ({}));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** QR + invitación (si hay plantilla) y después el estatus confirmed. */
// deno-lint-ignore no-explicit-any
async function prepareAndConfirm(db: any, event: any, reg: any) {
  try {
    if (!reg.qr_url) await callFn('generate-qr', { event_id: event.id, registration_ids: [reg.id] });
    const cfg = event.invitation_config ?? {};
    if (cfg.template_id && !reg.invitation_url) {
      const { data: job } = await db.from('invitation_jobs').insert({
        event_id: event.id, name: `VIP · ${reg.name ?? reg.id}`, config: cfg,
        registration_ids: [reg.id], force: false, total_rows: 1,
      }).select('id').single();
      if (job) {
        await callFn('invitations-run-batch', { job_id: job.id, batch_size: 1 });
        for (let i = 0; i < 30; i++) {
          const { data: j } = await db.from('invitation_jobs').select('status').eq('id', job.id).maybeSingle();
          if (!j || j.status === 'completed' || j.status === 'failed') break;
          await sleep(3000);
        }
      }
    }
  } catch (e) {
    console.error('rsvp: no se pudo preparar la invitación', (e as Error).message);
  }
  await db.from('registrations').update({ status: 'confirmed' }).eq('id', reg.id);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? '');
    if (!TOKEN_RE.test(token)) return fail('not_found', 'Este enlace no es válido');

    const { data: reg } = await db.from('registrations')
      .select('id, event_id, name, party_size, status, lang, rsvp_response, rsvp_at, qr_url, invitation_url, source')
      .eq('rsvp_token', token).maybeSingle();
    if (!reg) return fail('not_found', 'Este enlace no es válido');
    const { data: event } = await db.from('events')
      .select('id, slug, name, status, default_language, rsvp_config, invitation_config')
      .eq('id', reg.event_id).maybeSingle();
    if (!event) return fail('not_found', 'El evento no existe');

    const guest = { name: reg.name, party_size: reg.party_size, response: reg.rsvp_response, status: reg.status, vip: reg.source?.ref === 'vip' };
    const config = event.rsvp_config ?? {};

    if (body.action === 'get') return json({ ok: true, guest, config, event_status: event.status });

    if (body.action === 'answer') {
      const response = body.response === 'yes' ? 'yes' : body.response === 'no' ? 'no' : null;
      if (!response) return fail('bad_request', 'Respuesta inválida');
      if (!['published', 'closed'].includes(event.status)) return fail('closed', 'Este evento ya no recibe confirmaciones');
      await db.from('registrations').update({ rsvp_response: response, rsvp_at: new Date().toISOString() }).eq('id', reg.id);

      if (response === 'no') {
        if (reg.status !== 'checked_in') await db.from('registrations').update({ status: 'cancelled' }).eq('id', reg.id);
        return json({ ok: true, guest: { ...guest, response, status: 'cancelled' }, config });
      }
      const already = reg.status === 'confirmed' || reg.status === 'checked_in';
      if (!already) {
        if (config.auto_invitation) {
          const work = prepareAndConfirm(db, event, reg);
          // @ts-expect-error EdgeRuntime solo existe en el runtime de Supabase Edge Functions
          if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else await work;
        } else {
          await db.from('registrations').update({ status: 'confirmed' }).eq('id', reg.id);
        }
      }
      return json({ ok: true, guest: { ...guest, response, status: 'confirmed' }, config });
    }
    return fail('bad_request', 'Acción desconocida');
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});
