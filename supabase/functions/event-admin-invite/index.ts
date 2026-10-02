// ─────────────────────────────────────────────────────────────
// event-admin-invite — da acceso a un evento a un admin externo.
//
// Solo un usuario `super` puede llamarla. Los administradores entran
// siempre con correo y contraseña: si la cuenta no existe se crea con la
// contraseña indicada; si existe, se actualiza solo cuando se manda una.
// Queda como miembro y recibe por Resend un correo con cómo entrar; la
// contraseña se la comparte el super por otro canal.
//
// Body: { event_id, email, full_name?, password?, member_role?, reset_password? }
// La contraseña solo se aplica a cuentas nuevas. Para cambiar la de una
// cuenta existente hay que mandar reset_password: true, y nunca se toca
// la de una cuenta del equipo (profiles.role = super).
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/messaging.ts";
import { emailHtml, textToHtml } from "../_shared/messaging-core.ts";

const FROM_LOCAL = Deno.env.get('RESEND_FROM_LOCAL') ?? 'no-reply';
const FROM_DOMAIN = Deno.env.get('RESEND_FROM_DOMAIN') ?? 'eventos.we.page';

/** Correo de acceso al panel. Nunca lleva la contraseña. */
async function sendAccessEmail(a: {
  to: string; name: string; eventName: string; loginUrl: string;
  outcome: 'created' | 'existing' | 'password_updated';
}): Promise<void> {
  const hola = a.name ? `Hola ${a.name.split(/\s+/)[0]},` : 'Hola,';
  const lines: string[] = [
    hola, '',
    `Ya tienes acceso para administrar **${a.eventName}** en We.Page.`, '',
    `Entra en ${a.loginUrl} con este correo (${a.to}).`,
    a.outcome === 'existing'
      ? 'Usa la contraseña que ya tienes.'
      : 'La contraseña te la comparte directamente quien te dio el acceso.',
  ];
  const text = lines.join('\n');
  await sendEmail({
    from: `We.Page Eventos <${FROM_LOCAL}@${FROM_DOMAIN}>`,
    to: a.to,
    subject: `Acceso para administrar ${a.eventName}`,
    html: emailHtml(textToHtml(text), { eventName: a.eventName }),
    text: text.replace(/\*\*/g, ''),
    tags: { kind: 'admin_access' },
  });
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Panel de clientes: ahí entran los administradores de evento.
const PANEL_URL = Deno.env.get('PANEL_APP_URL') ?? 'https://panel.we.page';

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
    const resetPassword = body.reset_password === true;
    const member_role = ['owner', 'admin', 'viewer'].includes(body.member_role) ? body.member_role : 'admin';

    if (!event_id) return fail('bad_request', 'Falta event_id');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('bad_request', 'Correo inválido');

    const { data: event, error: eventErr } = await admin
      .from('events').select('id, name').eq('id', event_id).maybeSingle();
    if (eventErr || !event) return fail('not_found', 'El evento no existe');

    if (password && password.length < 8) {
      return fail('bad_request', 'La contraseña debe tener al menos 8 caracteres');
    }

    // 3. Usuario existente o nuevo (siempre con contraseña)
    const { data: existingId } = await admin.rpc('get_user_id_by_email', { p_email: email });
    let userId: string | null = existingId ?? null;
    let outcome: 'created' | 'existing' | 'password_updated' = 'existing';

    if (!userId) {
      if (!password) return fail('bad_request', 'La cuenta es nueva: indica una contraseña');
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (error) return fail('auth_error', error.message);
      userId = data.user.id;
      outcome = 'created';
    } else if (password && resetPassword) {
      const { data: target } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
      if (target?.role === 'super') {
        return fail('forbidden', 'Esa cuenta es del equipo We.Page: su contraseña no se cambia desde aquí');
      }
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return fail('auth_error', error.message);
      outcome = 'password_updated';
    }

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
        loginUrl: `${PANEL_URL}/login`,
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
