// ─────────────────────────────────────────────────────────────
// event-admin-invite — da acceso a un evento a un admin externo.
//
// Solo un usuario `super` puede llamarla. Según el método de acceso
// del evento:
//   magic_link → Supabase genera el enlace (invitación si no existe,
//                enlace mágico si ya existe) y el correo lo manda
//                Resend con nuestra plantilla. Queda como miembro.
//   password   → se crea el usuario con la contraseña indicada (o se
//                actualiza la contraseña si ya existe) y queda como
//                miembro. El super le comparte la contraseña.
//
// Body: { event_id, email, full_name?, password?, member_role? }
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/messaging.ts";
import { emailHtml, textToHtml } from "../_shared/messaging-core.ts";

const FROM_LOCAL = Deno.env.get('RESEND_FROM_LOCAL') ?? 'no-reply';
const FROM_DOMAIN = Deno.env.get('RESEND_FROM_DOMAIN') ?? 'eventos.we.page';

/** Correo de acceso al panel: enlace de entrada directo cuando lo hay. */
async function sendAccessEmail(a: {
  to: string; name: string; eventName: string; loginMethod: string;
  actionLink: string | null; landing: string; loginUrl: string;
  outcome: 'invited' | 'created' | 'existing' | 'password_updated';
}): Promise<void> {
  const hola = a.name ? `Hola ${a.name.split(/\s+/)[0]},` : 'Hola,';
  const lines: string[] = [hola, '', `Ya tienes acceso para administrar **${a.eventName}** en We.Page.`, ''];
  if (a.loginMethod === 'password') {
    lines.push(`Entra en ${a.loginUrl} con este correo (${a.to}).`);
    lines.push(a.outcome === 'created' || a.outcome === 'password_updated'
      ? 'La contraseña te la comparte directamente quien te dio el acceso.'
      : 'Usa la contraseña que ya tienes.');
  } else if (a.actionLink) {
    lines.push(`[Entrar al panel](${a.actionLink})`);
    lines.push('');
    lines.push(`Ese enlace es personal y de un solo uso. Si caduca, entra en ${a.loginUrl} y pide un nuevo enlace de acceso con este correo.`);
  } else {
    lines.push(`Entra en ${a.loginUrl} con este correo y pide tu enlace de acceso.`);
  }
  lines.push('', `Panel de eventos: ${a.landing}`);
  const text = lines.join('\n');
  await sendEmail({
    from: `We.Page Eventos <${FROM_LOCAL}@${FROM_DOMAIN}>`,
    to: a.to,
    subject: `Acceso para administrar ${a.eventName}`,
    html: emailHtml(textToHtml(text), { eventName: a.eventName }),
    text: text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2'),
    tags: { kind: 'admin_access' },
  });
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// A dónde aterriza el invitado después del enlace mágico.
const ADMIN_URL = Deno.env.get('ADMIN_APP_URL') ?? 'https://we-cotizador.onrender.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return fail('unauthorized', 'Falta la sesión');

    // 1. Quién llama (con su propio JWT)
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: callerErr } = await caller.auth.getUser();
    if (callerErr || !callerUser) return fail('unauthorized', 'Sesión inválida');

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: callerProfile } = await admin
      .from('profiles').select('role').eq('id', callerUser.id).maybeSingle();
    if (callerProfile?.role !== 'super') return fail('forbidden', 'Solo el equipo puede invitar admins');

    // 2. Entrada
    const body = await req.json().catch(() => ({}));
    const event_id = String(body.event_id ?? '');
    const email = String(body.email ?? '').trim().toLowerCase();
    const full_name = String(body.full_name ?? '').trim();
    const password = body.password ? String(body.password) : '';
    const member_role = ['owner', 'admin', 'viewer'].includes(body.member_role) ? body.member_role : 'admin';

    if (!event_id) return fail('bad_request', 'Falta event_id');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('bad_request', 'Correo inválido');

    const { data: event, error: eventErr } = await admin
      .from('events').select('id, name, login_method').eq('id', event_id).maybeSingle();
    if (eventErr || !event) return fail('not_found', 'El evento no existe');

    if (event.login_method === 'password' && password && password.length < 8) {
      return fail('bad_request', 'La contraseña debe tener al menos 8 caracteres');
    }

    // 3. Usuario existente o nuevo
    const { data: existingId } = await admin.rpc('get_user_id_by_email', { p_email: email });
    let userId: string | null = existingId ?? null;
    let outcome: 'invited' | 'created' | 'existing' | 'password_updated' = 'existing';
    const landing = `${ADMIN_URL}/admin/eventos`;
    // Enlace de un solo uso que inicia sesión y aterriza en Eventos (lo
    // genera Supabase; el correo lo mandamos nosotros por Resend).
    let actionLink: string | null = null;

    if (event.login_method === 'password') {
      if (!userId) {
        if (!password) return fail('bad_request', 'Este evento usa contraseña: indica una');
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name },
        });
        if (error) return fail('auth_error', error.message);
        userId = data.user.id;
        outcome = 'created';
      } else if (password) {
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) return fail('auth_error', error.message);
        outcome = 'password_updated';
      }
    } else {
      if (!userId) {
        const { data, error } = await admin.auth.admin.generateLink({
          type: 'invite',
          email,
          options: { data: { full_name }, redirectTo: landing },
        });
        if (error) return fail('auth_error', error.message);
        userId = data.user.id;
        actionLink = data.properties?.action_link ?? null;
        outcome = 'invited';
      } else {
        const { data, error } = await admin.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo: landing },
        });
        if (!error) actionLink = data.properties?.action_link ?? null;
      }
    }

    if (!userId) return fail('auth_error', 'No se pudo resolver el usuario');

    // 4. Perfil (el trigger ya lo crea; aquí solo completamos el nombre)
    await admin.from('profiles')
      .upsert({ id: userId, email, full_name: full_name || null }, { onConflict: 'id', ignoreDuplicates: false })
      .select();

    // 5. Membresía
    const { error: memberErr } = await admin
      .from('event_members')
      .upsert({ event_id, user_id: userId, role: member_role }, { onConflict: 'event_id,user_id' });
    if (memberErr) return fail('db_error', memberErr.message);

    // 6. Aviso por correo (Resend). Si falla, el acceso ya quedó dado: se
    //    informa, no se revierte.
    let emailError: string | null = null;
    try {
      await sendAccessEmail({
        to: email,
        name: full_name,
        eventName: event.name,
        loginMethod: event.login_method,
        actionLink,
        landing,
        loginUrl: `${ADMIN_URL}/admin/login`,
        outcome,
      });
    } catch (e) {
      emailError = (e as Error).message ?? 'No se pudo enviar el correo';
    }

    return json({ ok: true, user_id: userId, outcome, email_sent: !emailError, email_error: emailError });
  } catch (e) {
    return fail('unexpected', (e as Error).message ?? 'Error inesperado');
  }
});
