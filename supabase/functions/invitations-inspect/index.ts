// ─────────────────────────────────────────────────────────────
// invitations-inspect — descubre la plantilla de invitación de un
// evento a partir de la carpeta de Drive. Solo super.
//
// Body: { event_folder_url }
// Devuelve la carpeta, la presentación (única en la carpeta), sus
// marcadores {{...}}, cuántas formas llevan el QR (texto {{qr}} o
// texto alternativo {{qr}}) y un mapeo sugerido.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import {
  AppError, describeGoogleError, extractPlaceholders, findSingleFileByMime,
  getGoogleClients, MIME_FOLDER, MIME_SLIDES, norm, parseGoogleId,
} from "../_shared/google.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const QR_RE = /^\s*\{\{\s*qr\s*\}\}\s*$/i;

/** Alias → campo del registro. */
const FIELD_ALIASES: Record<string, string[]> = {
  name: ['nombre', 'invitado', 'guest', 'name', 'nombrecompleto', 'nombreinvitado'],
  first_name: ['primernombre', 'firstname'],
  party_size: ['pases', 'pase', 'boletos', 'lugares', 'tickets', 'personas', 'cantidad', 'acompanantes', 'nboletos'],
  phone: ['telefono', 'celular', 'whatsapp', 'phone', 'tel'],
  email: ['correo', 'email', 'mail'],
  company: ['empresa', 'company', 'organizacion'],
  event: ['evento', 'event'],
  date: ['fecha', 'date'],
  time: ['hora', 'time'],
  venue: ['lugar', 'venue', 'sede'],
};

/** Cuenta formas cuyo texto alternativo (título o descripción) es {{qr}}. */
// deno-lint-ignore no-explicit-any
function countQrAltShapes(presentation: any): number {
  let n = 0;
  // deno-lint-ignore no-explicit-any
  const walk = (els: any[]) => {
    for (const el of els ?? []) {
      if (QR_RE.test(el.title ?? '') || QR_RE.test(el.description ?? '')) n++;
      if (el.elementGroup?.children) walk(el.elementGroup.children);
    }
  };
  for (const page of presentation?.slides ?? []) walk(page.pageElements);
  return n;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let serviceAccountEmail = '';
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return fail('unauthorized', 'Sesión inválida');
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'super') return fail('forbidden', 'Solo el equipo puede configurar invitaciones');

    const body = await req.json().catch(() => ({}));
    const g = getGoogleClients();
    serviceAccountEmail = g.serviceAccountEmail;
    const { drive, slides } = g;

    const folderRef = parseGoogleId(String(body.event_folder_url ?? ''), 'la carpeta del evento');
    const folder = await drive.files.get({
      fileId: folderRef.id,
      fields: 'id,name,mimeType,driveId,webViewLink,capabilities(canAddChildren)',
      supportsAllDrives: true,
    });
    if (folder.data.mimeType !== MIME_FOLDER) throw new AppError('BAD_INPUT', 'Ese enlace no es una carpeta de Drive.');
    if (!folder.data.capabilities?.canAddChildren) {
      throw new AppError('PERMISSION_DENIED', `Tengo acceso a "${folder.data.name}" pero no puedo crear nada dentro. Comparte la carpeta con ${serviceAccountEmail} como Editor.`);
    }
    const warnings: string[] = [];
    if (!folder.data.driveId) warnings.push('La carpeta está en "Mi unidad": los PDFs consumirán la cuota de la cuenta de servicio. Mejor una Unidad compartida.');

    const tpl = await findSingleFileByMime(drive, folderRef.id, MIME_SLIDES, 'la plantilla de la invitación');
    const presentation = await slides.presentations.get({ presentationId: tpl.id });
    const textPlaceholders = extractPlaceholders(presentation.data);
    const qrText = textPlaceholders.filter(p => QR_RE.test(p)).length;
    const qrAlt = countQrAltShapes(presentation.data);
    const placeholders = textPlaceholders.filter(p => !QR_RE.test(p));
    const slideCount = (presentation.data.slides ?? []).length;
    if (slideCount > 1) warnings.push(`La plantilla tiene ${slideCount} diapositivas: cada PDF tendrá ${slideCount} páginas.`);
    if (qrText + qrAlt === 0) warnings.push('La plantilla no tiene ninguna forma con {{qr}}: los PDFs saldrán sin QR.');

    const suggested: Record<string, { source: string; field?: string; value?: string }> = {};
    for (const ph of placeholders) {
      const inner = norm(ph.replace(/[{}]/g, ''));
      const field = Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.some(a => a === inner))?.[0];
      suggested[ph] = field ? { source: 'field', field } : { source: 'literal', value: '' };
    }

    return json({
      ok: true,
      service_account_email: serviceAccountEmail,
      folder: { id: folder.data.id, name: folder.data.name, url: folder.data.webViewLink },
      template: { id: tpl.id, name: tpl.name, url: `https://docs.google.com/presentation/d/${tpl.id}/edit`, placeholders, qr_shapes: qrText + qrAlt, slide_count: slideCount },
      suggested_map: suggested,
      warnings,
    });
  } catch (e) {
    if (e instanceof AppError) return fail(e.code, e.message, { service_account_email: serviceAccountEmail });
    const { code, message } = describeGoogleError(e, 'la carpeta o la plantilla', serviceAccountEmail);
    return fail(code, message, { service_account_email: serviceAccountEmail });
  }
});
