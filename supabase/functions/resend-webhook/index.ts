// ─────────────────────────────────────────────────────────────
// resend-webhook — Resend nos avisa qué pasó con cada correo y
// actualizamos la bitácora (entregado, abierto, rebotó…).
//
// Configurar en Resend → Webhooks con la URL de esta función y
// desplegarla con --no-verify-jwt (Resend no manda JWT de Supabase).
// Si RESEND_WEBHOOK_SECRET está en los secretos, se verifica la firma
// (formato Svix: svix-id, svix-timestamp, svix-signature).
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json, fail } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';

const STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'opened',
  'email.bounced': 'bounced',
  'email.complained': 'bounced',
  'email.delivery_delayed': 'sent',
};

// No retroceder: abierto > entregado > enviado
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, opened: 3, bounced: 4, failed: 4, exported: 1 };

async function verify(req: Request, raw: string): Promise<boolean> {
  if (!SECRET) return true;
  const id = req.headers.get('svix-id') ?? '';
  const ts = req.headers.get('svix-timestamp') ?? '';
  const sigs = req.headers.get('svix-signature') ?? '';
  if (!id || !ts || !sigs) return false;
  const secretBytes = Uint8Array.from(atob(SECRET.replace(/^whsec_/, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return sigs.split(' ').some(s => s.split(',')[1] === expected);
}

serve(async (req) => {
  try {
    const raw = await req.text();
    if (!(await verify(req, raw))) return json({ ok: false, code: 'unauthorized', message: 'Firma inválida' }, 401);
    const evt = JSON.parse(raw);
    const type = String(evt.type ?? '');
    const emailId = String(evt.data?.email_id ?? '');
    const next = STATUS[type];
    if (!next || !emailId) return json({ ok: true, ignored: true });

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: msg } = await db.from('messages').select('id, status, meta').eq('provider_id', emailId).maybeSingle();
    if (!msg) return json({ ok: true, unknown: true });

    const meta = { ...(msg.meta ?? {}), [type]: evt.created_at ?? new Date().toISOString() };
    if (type === 'email.bounced' && evt.data?.bounce) meta.bounce = evt.data.bounce;
    const update: Record<string, unknown> = { meta };
    if ((RANK[next] ?? 0) >= (RANK[msg.status] ?? 0)) update.status = next;
    if (next === 'bounced') update.error = evt.data?.bounce?.message ?? 'bounced';
    await db.from('messages').update(update).eq('id', msg.id);
    return json({ ok: true });
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});
