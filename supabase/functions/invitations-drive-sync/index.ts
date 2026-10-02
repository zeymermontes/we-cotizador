// ─────────────────────────────────────────────────────────────
// invitations-drive-sync — espejo en Google Drive de las invitaciones
// genéricas (las imágenes viven en el bucket; aquí solo se copian para
// que el equipo las tenga ordenadas por evento). Solo super.
//
// Carpeta raíz: secreto EVENTS_ROOT_FOLDER_ID, compartida con la cuenta de
// servicio. Dentro se crea "<nombre del evento>/Invitaciones".
//
// Body: { event_id, registration_ids?: string[], action?: 'sync' | 'remove', batch?: number }
//   sync   → sube (o reemplaza) la invitación de cada registro con invitation_url
//   remove → manda a la papelera el archivo de Drive y limpia las columnas
// Responde { ok, done, failed, remaining, folder_url } y el cliente repite
// hasta remaining = 0.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Readable } from "node:stream";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { describeGoogleError, findFolderByName, getGoogleClients, withRetry } from "../_shared/google.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ROOT_FOLDER_ID = Deno.env.get('EVENTS_ROOT_FOLDER_ID') ?? '';

const safeName = (s: string) => (s || 'invitado').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// deno-lint-ignore no-explicit-any
async function ensureFolder(drive: any, parentId: string, name: string): Promise<{ id: string; webViewLink: string }> {
  const found = await findFolderByName(drive, parentId, name);
  if (found) return found;
  const created = await withRetry('crear la carpeta', () =>
    drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    }));
  return { id: created.data.id as string, webViewLink: created.data.webViewLink as string };
}

// deno-lint-ignore no-explicit-any
async function trash(drive: any, fileId: string) {
  await drive.files.delete({ fileId, supportsAllDrives: true }).catch(() =>
    drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true }).catch(() => {}));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  let serviceAccountEmail = '';

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return fail('unauthorized', 'Sesión inválida');
    const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'super') return fail('forbidden', 'Solo el equipo puede copiar invitaciones a Drive');

    const body = await req.json().catch(() => ({}));
    const eventId = String(body.event_id ?? '');
    const action: 'sync' | 'remove' = body.action === 'remove' ? 'remove' : 'sync';
    const ids: string[] | null = Array.isArray(body.registration_ids) ? body.registration_ids.map(String) : null;
    const batch = Math.max(1, Math.min(25, Number(body.batch ?? 15)));
    if (!eventId) return fail('bad_request', 'Falta event_id');

    const { data: event } = await db.from('events').select('id, name, slug, drive_folder_id, drive_folder_url').eq('id', eventId).maybeSingle();
    if (!event) return fail('not_found', 'El evento no existe');

    const g = getGoogleClients();
    serviceAccountEmail = g.serviceAccountEmail;
    const { drive } = g;

    // Pendientes: con invitación en el bucket y sin copia (sync) o con copia (remove)
    let q = db.from('registrations').select('id, name, invitation_url, invitation_drive_id').eq('event_id', eventId);
    if (ids) q = q.in('id', ids);
    if (action === 'sync') q = q.not('invitation_url', 'is', null).is('invitation_drive_id', null);
    else q = q.not('invitation_drive_id', 'is', null);
    const { data: rows } = await q.order('created_at').limit(batch + 1);
    const pending = rows ?? [];
    const slice = pending.slice(0, batch);
    const remaining = Math.max(0, pending.length - slice.length);

    let folderUrl = event.drive_folder_url as string | null;
    let outFolderId: string | null = null;
    if (action === 'sync' && slice.length) {
      if (!ROOT_FOLDER_ID) {
        return fail('CONFIG', `Falta la carpeta raíz de eventos en Drive: crea una, compártela con ${serviceAccountEmail} y guarda su id como EVENTS_ROOT_FOLDER_ID.`, { service_account_email: serviceAccountEmail });
      }
      let eventFolderId = event.drive_folder_id as string | null;
      if (!eventFolderId) {
        const f = await ensureFolder(drive, ROOT_FOLDER_ID, safeName(event.name) || event.slug);
        eventFolderId = f.id;
        folderUrl = f.webViewLink;
        await db.from('events').update({ drive_folder_id: f.id, drive_folder_url: f.webViewLink }).eq('id', eventId);
      }
      outFolderId = (await ensureFolder(drive, eventFolderId, 'Invitaciones')).id;
    }

    let done = 0;
    let failed = 0;
    const errors: { id: string; message: string }[] = [];
    for (const r of slice) {
      try {
        if (action === 'remove') {
          if (r.invitation_drive_id) await trash(drive, r.invitation_drive_id);
          await db.from('registrations').update({ invitation_drive_id: null, invitation_drive_url: null }).eq('id', r.id);
          done++;
          continue;
        }
        const res = await fetch(r.invitation_url as string);
        if (!res.ok) throw new Error(`No se pudo leer la imagen (${res.status})`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const mime = res.headers.get('content-type') ?? 'image/png';
        const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
        const fileName = `${safeName(r.name ?? '')}-${String(r.id).slice(0, 6)}.${ext}`;
        if (r.invitation_drive_id) await trash(drive, r.invitation_drive_id);
        const uploaded = await withRetry('subir la invitación', () =>
          drive.files.create({
            requestBody: { name: fileName, mimeType: mime, parents: [outFolderId as string] },
            media: { mimeType: mime, body: Readable.from([bytes]) },
            fields: 'id, webViewLink',
            supportsAllDrives: true,
          }));
        await db.from('registrations').update({ invitation_drive_id: uploaded.data.id, invitation_drive_url: uploaded.data.webViewLink }).eq('id', r.id);
        done++;
      } catch (e) {
        failed++;
        errors.push({ id: r.id, message: describeGoogleError(e, 'la carpeta de Drive', serviceAccountEmail).message });
      }
    }

    return json({ ok: true, done, failed, remaining, folder_url: folderUrl, errors });
  } catch (e) {
    const d = describeGoogleError(e, 'Drive', serviceAccountEmail);
    return fail(d.code, d.message, { service_account_email: serviceAccountEmail });
  }
});
