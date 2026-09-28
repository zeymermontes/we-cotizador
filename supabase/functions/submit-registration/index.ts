// ─────────────────────────────────────────────────────────────
// submit-registration — recibe un registro del formulario público.
//
// El público no inserta directo en `registrations`: aquí se valida
// contra la versión publicada del formulario (misma lógica que el
// navegador, ver _shared/form-engine.ts), se aplican duplicados,
// cupo y cierre, y se inserta con service role.
//
// Body: { slug, submission_id, lang, answers, source?, website? }
// `website` es un honeypot: los humanos no lo ven, los bots lo llenan.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { normalizeSchema, validateSubmission, extractIdentity, type Answers } from "../_shared/form-engine.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug ?? '');
    const submission_id = String(body.submission_id ?? '');
    const lang = body.lang === 'en' ? 'en' : 'es';
    const answers = (body.answers && typeof body.answers === 'object' ? body.answers : {}) as Answers;
    const source = (body.source && typeof body.source === 'object' ? body.source : {}) as Record<string, unknown>;

    // Honeypot: respondemos ok para no darle pistas al bot, pero no guardamos.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return json({ ok: true, registration_id: null });
    }

    if (!slug || !UUID_RE.test(submission_id)) return fail('invalid', 'Solicitud inválida');

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Evento + formulario publicado
    const { data: event } = await db
      .from('events')
      .select('id, status, capacity, registration_closes_at')
      .eq('slug', slug)
      .maybeSingle();
    if (!event) return fail('not_found', 'El evento no existe');
    if (event.status !== 'published') return fail('closed', 'El registro está cerrado');
    if (event.registration_closes_at && new Date(event.registration_closes_at) < new Date()) {
      return fail('closed', 'El registro está cerrado');
    }

    const { data: form } = await db
      .from('event_forms_public')
      .select('version, schema')
      .eq('slug', slug)
      .maybeSingle();
    if (!form) return fail('not_found', 'El formulario no está publicado');
    const schema = normalizeSchema(form.schema);

    // 2. Idempotencia: si ya lo guardamos, devolvemos lo mismo.
    const { data: existing } = await db
      .from('registrations').select('id').eq('submission_id', submission_id).maybeSingle();
    if (existing) return json({ ok: true, registration_id: existing.id, duplicate_submission: true });

    // 3. Validación con el mismo motor que el navegador
    const { errors, clean } = validateSubmission(schema, answers);
    if (Object.keys(errors).length > 0) {
      return fail('invalid', 'Hay respuestas inválidas', { errors });
    }
    const identity = extractIdentity(schema, clean);

    // 4. Duplicados
    const dup = schema.settings.duplicates;
    if (dup !== 'allow') {
      const checks: Promise<boolean>[] = [];
      if ((dup === 'block_email' || dup === 'block_both') && identity.email) {
        checks.push(db.from('registrations').select('id', { count: 'exact', head: true })
          .eq('event_id', event.id).eq('email', identity.email).neq('status', 'cancelled')
          .then(r => (r.count ?? 0) > 0));
      }
      if ((dup === 'block_phone' || dup === 'block_both') && identity.phone) {
        checks.push(db.from('registrations').select('id', { count: 'exact', head: true })
          .eq('event_id', event.id).eq('phone', identity.phone).neq('status', 'cancelled')
          .then(r => (r.count ?? 0) > 0));
      }
      if ((await Promise.all(checks)).some(Boolean)) return fail('duplicate', 'Ya existe un registro con estos datos');
    }

    // 5. Cupo (cuenta personas, no registros)
    let status: 'registered' | 'waitlist' = 'registered';
    if (event.capacity) {
      const { data: rows } = await db
        .from('registrations').select('party_size')
        .eq('event_id', event.id).neq('status', 'cancelled').neq('status', 'waitlist');
      const used = (rows ?? []).reduce((s, r) => s + (r.party_size ?? 1), 0);
      if (used + identity.party_size > event.capacity) status = 'waitlist';
    }

    // 6. Insertar
    const ua = req.headers.get('user-agent') ?? '';
    const { data: inserted, error } = await db
      .from('registrations')
      .insert({
        event_id: event.id,
        form_version: form.version,
        submission_id,
        answers: clean,
        lang,
        name: identity.name,
        email: identity.email,
        phone: identity.phone,
        party_size: identity.party_size,
        company: identity.company,
        status,
        source: { ...pickSource(source), ua: ua.slice(0, 200) },
      })
      .select('id')
      .single();

    if (error) {
      // Carrera con el mismo submission_id: ya está guardado.
      if (error.code === '23505') {
        const { data: again } = await db.from('registrations').select('id').eq('submission_id', submission_id).maybeSingle();
        if (again) return json({ ok: true, registration_id: again.id, duplicate_submission: true });
      }
      return fail('db_error', error.message);
    }

    // Fase 4: aquí se disparan las automatizaciones (confirmación por correo, etc.)

    return json({ ok: true, registration_id: inserted.id, status });
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});

/** Solo guardamos claves conocidas y cortas del origen. */
function pickSource(src: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!/^(utm_[a-z]+|ref|referrer|fbclid|gclid)$/.test(k)) continue;
    if (typeof v === 'string' && v) out[k] = v.slice(0, 200);
  }
  return out;
}
