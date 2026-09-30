// ─────────────────────────────────────────────────────────────
// scanner-checkin — todo lo que hace el scanner con su token.
//
// Body: { token, action, ... }
//   action 'scan'   { code }               QR leído ("WE1:<token>" o el token)
//   action 'manual' { registration_id }    check-in a mano desde la búsqueda
//   action 'search' { q }                  buscar invitados por nombre/correo/tel
//   action 'stats'                         contadores + últimos accesos
//   action 'undo'   { check_in_id }        deshacer un acceso
//
// Regla de grupos: el primer escaneo admite a todo el grupo que falte
// (party_size − ya entrados). Un segundo escaneo se marca como
// duplicado y muestra a qué hora entró.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// deno-lint-ignore no-explicit-any
type Db = any;

interface Guest {
  id: string; name: string | null; email: string | null; phone: string | null; company: string | null;
  party_size: number; status: string; tags: string[]; notes: string | null; entered: number; last_at: string | null;
}

async function enteredFor(db: Db, ids: string[]): Promise<Map<string, { entered: number; last_at: string | null }>> {
  const map = new Map<string, { entered: number; last_at: string | null }>();
  if (ids.length === 0) return map;
  const { data } = await db.from('check_ins').select('registration_id, count, scanned_at').in('registration_id', ids);
  for (const c of data ?? []) {
    const cur = map.get(c.registration_id) ?? { entered: 0, last_at: null };
    cur.entered += c.count;
    if (!cur.last_at || c.scanned_at > cur.last_at) cur.last_at = c.scanned_at;
    map.set(c.registration_id, cur);
  }
  return map;
}

// deno-lint-ignore no-explicit-any
function toGuest(r: any, e?: { entered: number; last_at: string | null }): Guest {
  return {
    id: r.id, name: r.name, email: r.email, phone: r.phone, company: r.company,
    party_size: r.party_size ?? 1, status: r.status, tags: r.tags ?? [], notes: r.notes,
    entered: e?.entered ?? 0, last_at: e?.last_at ?? null,
  };
}

// deno-lint-ignore no-explicit-any
async function admit(db: Db, session: any, r: any, method: 'qr' | 'manual') {
  const e = (await enteredFor(db, [r.id])).get(r.id);
  const guest = toGuest(r, e);
  if (r.status === 'cancelled') return { result: 'cancelled', guest };
  if (guest.entered >= guest.party_size) return { result: 'duplicate', guest };

  const count = guest.party_size - guest.entered;
  const { data: ci, error } = await db.from('check_ins')
    .insert({ event_id: session.event_id, registration_id: r.id, session_id: session.id, count, method, prev_status: r.status })
    .select('id, scanned_at').single();
  if (error) throw new Error(error.message);
  if (r.status !== 'checked_in') await db.from('registrations').update({ status: 'checked_in' }).eq('id', r.id);
  await db.from('scanner_sessions').update({ scans: (session.scans ?? 0) + 1, last_seen_at: new Date().toISOString() }).eq('id', session.id);

  return { result: 'ok', guest: { ...guest, status: 'checked_in', entered: guest.entered + count, last_at: ci.scanned_at }, check_in_id: ci.id, admitted: count };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? '');
    const action = String(body.action ?? 'scan');
    if (!token) return fail('unauthorized', 'Falta el token');

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: session } = await db.from('scanner_sessions').select('*').eq('token', token).maybeSingle();
    if (!session || new Date(session.expires_at) < new Date()) return fail('session_expired', 'La sesión del scanner expiró. Vuelve a escribir el PIN.');
    const eventId = session.event_id;

    if (action === 'scan') {
      const raw = String(body.code ?? '').trim();
      const qr = raw.replace(/^WE1:/i, '').trim();
      if (!/^[0-9a-f]{16,64}$/i.test(qr)) return json({ ok: true, result: 'invalid' });
      const { data: r } = await db.from('registrations').select('*').eq('event_id', eventId).eq('qr_token', qr).maybeSingle();
      if (!r) return json({ ok: true, result: 'invalid' });
      return json({ ok: true, ...(await admit(db, session, r, 'qr')) });
    }

    if (action === 'manual') {
      const id = String(body.registration_id ?? '');
      const { data: r } = await db.from('registrations').select('*').eq('event_id', eventId).eq('id', id).maybeSingle();
      if (!r) return json({ ok: true, result: 'invalid' });
      return json({ ok: true, ...(await admit(db, session, r, 'manual')) });
    }

    if (action === 'search') {
      const q = String(body.q ?? '').trim();
      if (q.length < 2) return json({ ok: true, results: [] });
      const like = `%${q.replace(/[%_]/g, '')}%`;
      const { data: rows } = await db.from('registrations').select('*').eq('event_id', eventId)
        .or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like},company.ilike.${like}`)
        .order('name').limit(12);
      const entered = await enteredFor(db, (rows ?? []).map((r: { id: string }) => r.id));
      // deno-lint-ignore no-explicit-any
      return json({ ok: true, results: (rows ?? []).map((r: any) => toGuest(r, entered.get(r.id))) });
    }

    if (action === 'undo') {
      const id = String(body.check_in_id ?? '');
      const { data: ci } = await db.from('check_ins').select('*').eq('id', id).eq('event_id', eventId).maybeSingle();
      if (!ci) return fail('not_found', 'Ese acceso ya no existe');
      await db.from('check_ins').delete().eq('id', ci.id);
      const left = (await enteredFor(db, [ci.registration_id])).get(ci.registration_id)?.entered ?? 0;
      if (left === 0) await db.from('registrations').update({ status: ci.prev_status ?? 'confirmed' }).eq('id', ci.registration_id);
      return json({ ok: true });
    }

    if (action === 'stats') {
      const [{ data: regs }, { data: cis }] = await Promise.all([
        db.from('registrations').select('id, name, party_size, status').eq('event_id', eventId).neq('status', 'cancelled'),
        db.from('check_ins').select('id, registration_id, count, scanned_at, method').eq('event_id', eventId).order('scanned_at', { ascending: false }).limit(2000),
      ]);
      const names = new Map((regs ?? []).map((r: { id: string; name: string | null }) => [r.id, r.name]));
      const expectedPeople = (regs ?? []).reduce((s: number, r: { party_size: number }) => s + (r.party_size ?? 1), 0);
      const enteredPeople = (cis ?? []).reduce((s: number, c: { count: number }) => s + c.count, 0);
      const enteredRegs = new Set((cis ?? []).map((c: { registration_id: string }) => c.registration_id)).size;
      await db.from('scanner_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id);
      return json({
        ok: true,
        stats: { registrations: (regs ?? []).length, expected_people: expectedPeople, entered_registrations: enteredRegs, entered_people: enteredPeople },
        // deno-lint-ignore no-explicit-any
        recent: (cis ?? []).slice(0, 15).map((c: any) => ({ id: c.id, name: names.get(c.registration_id) ?? '—', count: c.count, at: c.scanned_at, method: c.method })),
      });
    }

    return fail('bad_request', 'Acción desconocida');
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});
