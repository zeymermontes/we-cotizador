// ─────────────────────────────────────────────────────────────
// send-messages — envío manual de una plantilla de correo a los
// registros seleccionados, o prueba a una dirección.
//
// Body: { event_id, template_id, registration_ids: string[], test_to?: string }
// Solo miembros del evento o super.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { sendTemplate, loadPublishedSchema } from "../_shared/messaging.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BATCH = 500;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return fail('unauthorized', 'Sesión inválida');

    const body = await req.json().catch(() => ({}));
    const event_id = String(body.event_id ?? '');
    const template_id = String(body.template_id ?? '');
    const ids: string[] = Array.isArray(body.registration_ids) ? body.registration_ids.map(String).slice(0, MAX_BATCH) : [];
    const test_to = typeof body.test_to === 'string' && body.test_to.includes('@') ? body.test_to.trim() : undefined;
    if (!event_id || !template_id) return fail('bad_request', 'Faltan datos');

    // Permiso: el evento debe ser visible para quien llama (RLS lo decide)
    const { data: visible } = await caller.from('events').select('id').eq('id', event_id).maybeSingle();
    if (!visible) return fail('forbidden', 'Sin acceso a este evento');

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const [{ data: event }, { data: template }] = await Promise.all([
      db.from('events').select('id, slug, name, event_date, timezone, venue, sender_name, reply_to, branding').eq('id', event_id).maybeSingle(),
      db.from('message_templates').select('*').eq('id', template_id).eq('event_id', event_id).maybeSingle(),
    ]);
    if (!event || !template) return fail('not_found', 'Evento o plantilla no encontrados');

    let regs: any[] = [];
    if (test_to) {
      const { data } = ids.length
        ? await db.from('registrations').select('*').eq('event_id', event_id).in('id', ids.slice(0, 1))
        : await db.from('registrations').select('*').eq('event_id', event_id).order('created_at', { ascending: false }).limit(1);
      regs = data ?? [];
      if (regs.length === 0) {
        // Sin registros aún: uno de muestra para la prueba
        regs = [{ id: 'sample', event_id, name: 'Ana Ejemplo', email: test_to, phone: '+5213312345678', party_size: 2, company: 'We.Page', lang: 'es', answers: {}, status: 'registered' }];
      }
    } else {
      if (ids.length === 0) return fail('bad_request', 'No hay registros seleccionados');
      const { data } = await db.from('registrations').select('*').eq('event_id', event_id).in('id', ids);
      regs = data ?? [];
    }

    const schema = await loadPublishedSchema(db, event_id);
    const summary = await sendTemplate(db, { event, template, registrations: regs, schema, trigger: test_to ? 'test' : 'manual', testTo: test_to });
    return json({ ok: true, ...summary });
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});
