// ─────────────────────────────────────────────────────────────
// run-automations — ejecuta automatizaciones de correo.
//
// La llaman:
//   - el trigger de Postgres al cambiar el estatus de un registro
//     { type:'status', registration_id, old_status, new_status }
//   - pg_cron cada hora para recordatorios
//     { type:'reminders' }
//
// Pasa el gateway con la anon key (Vault). Si AUTOMATION_KEY está
// definida en los secretos, además exige el header x-automation-key.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { runAutomation, sendTemplate, loadPublishedSchema, type Trigger } from "../_shared/messaging.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AUTOMATION_KEY = Deno.env.get('AUTOMATION_KEY') ?? '';

const STATUS_TRIGGER: Record<string, Trigger> = {
  waitlist: 'on_waitlist',
  selected: 'on_selected',
  invited: 'on_invited',
  confirmed: 'on_confirmed',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (AUTOMATION_KEY && req.headers.get('x-automation-key') !== AUTOMATION_KEY) {
      return fail('unauthorized', 'Clave inválida');
    }
    const body = await req.json().catch(() => ({}));
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    if (body.type === 'status') {
      const trigger = STATUS_TRIGGER[String(body.new_status)];
      const id = String(body.registration_id ?? '');
      if (!trigger || !id) return json({ ok: true, skipped: true });
      const { data: reg } = await db.from('registrations').select('id, event_id').eq('id', id).maybeSingle();
      if (!reg) return json({ ok: true, skipped: true });
      const summary = await runAutomation(db, reg.event_id, trigger, [reg.id]);
      return json({ ok: true, trigger, summary });
    }

    if (body.type === 'reminders') {
      // Eventos con recordatorio activo cuya fecha cae dentro de la ventana
      const { data: autos } = await db.from('automations')
        .select('event_id, template_id, days_before, events!inner(id, slug, name, event_date, timezone, venue, sender_name, reply_to, branding, status)')
        .eq('trigger', 'reminder').eq('enabled', true).not('template_id', 'is', null);
      const results: unknown[] = [];
      const now = Date.now();
      for (const a of autos ?? []) {
        const ev = (a as any).events;
        if (!ev?.event_date || !['published', 'closed'].includes(ev.status)) continue;
        const eventMs = new Date(ev.event_date).getTime();
        const sendAt = eventMs - a.days_before * 86400_000;
        // Ventana: ya toca (sendAt <= ahora) y el evento aún no pasó
        if (sendAt > now || eventMs < now) continue;

        const { data: regs } = await db.from('registrations').select('*')
          .eq('event_id', ev.id)
          .in('status', ['invited', 'confirmed'])
          .is('reminder_sent_at', null)
          .not('email', 'is', null)
          .limit(300);
        if (!regs?.length) continue;

        const { data: template } = await db.from('message_templates').select('*').eq('id', a.template_id).maybeSingle();
        if (!template) continue;
        const schema = await loadPublishedSchema(db, ev.id);
        const summary = await sendTemplate(db, { event: ev, template, registrations: regs, schema, trigger: 'reminder' });
        await db.from('registrations').update({ reminder_sent_at: new Date().toISOString() }).in('id', regs.map((r: { id: string }) => r.id));
        results.push({ event: ev.slug, ...summary });
      }
      return json({ ok: true, results });
    }

    return fail('bad_request', 'Tipo desconocido');
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});
