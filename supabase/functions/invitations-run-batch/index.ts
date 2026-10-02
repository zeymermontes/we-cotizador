// ─────────────────────────────────────────────────────────────
// invitations-run-batch — genera el PDF de invitación de cada
// registro de una corrida (invitation_jobs) desde la plantilla de
// Slides, con el QR del invitado. Solo super.
//
// Body: { job_id, batch_size?, cron_secret?, chain_depth? }
// Procesa unos pocos registros por llamada y encadena la siguiente por sí
// misma (EdgeRuntime.waitUntil), así que el navegador solo arranca la
// corrida y luego mira el progreso en invitation_jobs. Si la cadena se
// corta, invitations_watchdog (pg_cron) la revive con cron_secret.
// Un lock cooperativo evita dos lotes a la vez.
//
// Salida (config.output_format): 'png' (por defecto) exporta la primera
// diapositiva como imagen vía la miniatura de Slides → bucket event-assets
// + copia en Drive; 'pdf' exporta el PDF a Drive como antes.
//
// El QR entra de dos formas:
//   - texto {{qr}} dentro de una forma → replaceAllShapesWithImage
//   - texto alternativo {{qr}} en una forma/imagen → createImage con el
//     mismo tamaño y posición + borrar la forma original
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Readable } from "node:stream";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { unwrapPdfLinks } from "../_shared/pdf.ts";
import {
  describeGoogleError, escapeQ, findFolderByName, getGoogleClients, isRetryable,
  sanitizeFileName, sleep, withRetry,
} from "../_shared/google.ts";
import { normalizeSchema } from "../_shared/form-engine.ts";
import { trashFile } from "../_shared/drive-folders.ts";
import { buildVars, renderTemplate } from "../_shared/messaging-core.ts";
import { loadPublishedSchema } from "../_shared/messaging.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EXPORT_DELAY_MS = Number(Deno.env.get('EXPORT_DELAY_MS') ?? 1200);
const LOCK_TTL_MS = 120_000;
const CRON_SECRET = Deno.env.get('JOBS_CRON_SECRET') ?? '';
const MAX_CHAIN_DEPTH = 400;
const QR_RE = /^\s*\{\{\s*qr\s*\}\}\s*$/i;

interface Mapping { source: 'field' | 'question' | 'literal' | 'qr' | 'empty'; field?: string; questionId?: string; value?: string }

const FIELD_TO_VAR: Record<string, string> = {
  name: 'nombre', first_name: 'primer_nombre', email: 'correo', phone: 'telefono', party_size: 'personas',
  company: 'empresa', event: 'evento', date: 'fecha', time: 'hora', venue: 'lugar', party_text: 'pases_texto',
};

/** Ruta dentro del bucket a partir de una URL pública de event-assets. */
function bucketPath(url: string | null): string | null {
  const m = (url ?? '').match(/\/object\/public\/event-assets\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  let serviceAccountEmail = '';
  let jobId = '';
  let lockToken = '';

  try {
    const body = await req.json().catch(() => ({}));
    // Llamadas del propio encadenado o del vigilante: llevan el secreto; las demás, un super.
    const trusted = !!CRON_SECRET && body.cron_secret === CRON_SECRET;
    if (!trusted) {
      const authHeader = req.headers.get('Authorization') ?? '';
      const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return fail('unauthorized', 'Sesión inválida');
      const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (profile?.role !== 'super') return fail('forbidden', 'Solo el equipo puede generar invitaciones');
    }
    jobId = String(body.job_id ?? '');
    const chainDepth = Number(body.chain_depth ?? 0);
    const batchSize = Math.max(1, Math.min(10, Number(body.batch_size ?? 6)));
    if (!jobId) return fail('bad_request', 'Falta job_id');

    // ── Lock ──────────────────────────────────────────────────
    const { data: job } = await db.from('invitation_jobs').select('*').eq('id', jobId).maybeSingle();
    if (!job) return fail('not_found', 'La corrida no existe');
    if (job.status === 'completed') return json({ ok: true, remaining: 0, processed: job.processed_rows, failed: job.failed_rows, completed: true });
    if (job.locked_at && Date.now() - new Date(job.locked_at).getTime() < LOCK_TTL_MS) {
      return fail('LOCKED', 'Ya hay un lote corriendo. Espera un momento.', { retryable: true });
    }
    lockToken = crypto.randomUUID();
    const { data: locked } = await db.from('invitation_jobs')
      .update({ lock_token: lockToken, locked_at: new Date().toISOString(), status: 'running', started_at: job.started_at ?? new Date().toISOString() })
      .eq('id', jobId).or(`locked_at.is.null,locked_at.lt.${new Date(Date.now() - LOCK_TTL_MS).toISOString()}`)
      .select('id').maybeSingle();
    if (!locked) return fail('LOCKED', 'Otro lote tomó el turno.', { retryable: true });

    const cfg = job.config as {
      event_folder_id: string; template_id: string; output_folder_name?: string;
      placeholder_map: Record<string, Mapping>; file_name_template?: string; output_format?: 'png' | 'pdf';
    };
    const asPdf = cfg.output_format === 'pdf';
    const ext = asPdf ? 'pdf' : 'png';
    const mime = asPdf ? 'application/pdf' : 'image/png';

    const g = getGoogleClients();
    serviceAccountEmail = g.serviceAccountEmail;
    const { drive, slides } = g;

    const { data: event } = await db.from('events').select('id, slug, name, event_date, timezone, venue, sender_name, reply_to, branding').eq('id', job.event_id).maybeSingle();
    if (!event) throw new Error('El evento no existe');
    const schema = (await loadPublishedSchema(db, event.id)) ?? normalizeSchema({});

    // ── Carpeta de salida + _tmp ──────────────────────────────
    let outputFolderId = job.output_folder_id as string | null;
    if (!outputFolderId) {
      const name = (cfg.output_folder_name || 'Invitaciones').trim();
      let folder = await findFolderByName(drive, cfg.event_folder_id, name);
      if (!folder) {
        const created = await withRetry('crear la carpeta de salida', () =>
          drive.files.create({
            requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [cfg.event_folder_id] },
            fields: 'id, webViewLink', supportsAllDrives: true,
          }));
        folder = { id: created.data.id as string, webViewLink: created.data.webViewLink as string };
      }
      outputFolderId = folder.id;
      await db.from('invitation_jobs').update({ output_folder_id: outputFolderId, output_folder_url: folder.webViewLink }).eq('id', jobId);
    }
    let tmpFolderId = job.tmp_folder_id as string | null;
    if (!tmpFolderId) {
      const found = await findFolderByName(drive, outputFolderId, '_tmp');
      if (found) tmpFolderId = found.id;
      else {
        const created = await withRetry('crear la carpeta _tmp', () =>
          drive.files.create({
            requestBody: { name: '_tmp', mimeType: 'application/vnd.google-apps.folder', parents: [outputFolderId as string] },
            fields: 'id', supportsAllDrives: true,
          }));
        tmpFolderId = created.data.id as string;
      }
      await db.from('invitation_jobs').update({ tmp_folder_id: tmpFolderId }).eq('id', jobId);
    }

    // ── Pendientes de esta corrida ────────────────────────────
    const ids: string[] = job.registration_ids ?? [];
    const failedIds = new Set(((job.row_errors ?? []) as { registration_id: string }[]).map(e => e.registration_id));
    let q = db.from('registrations').select('*').in('id', ids).neq('status', 'cancelled').not('qr_url', 'is', null);
    if (!job.force) q = q.is('invitation_url', null);
    const { data: candidates } = await q.order('created_at');
    const pending = (candidates ?? []).filter((r: { id: string }) => !failedIds.has(r.id));
    const batch = pending.slice(0, batchSize);

    // Formas con alt text {{qr}} de la plantilla (se calculan una vez)
    const tplDoc = await withRetry('leer la plantilla', () => slides.presentations.get({ presentationId: cfg.template_id }));
    const altShapes: { objectId: string; pageObjectId: string; size: unknown; transform: unknown }[] = [];
    // deno-lint-ignore no-explicit-any
    const walk = (els: any[], pageId: string) => {
      for (const el of els ?? []) {
        if (QR_RE.test(el.title ?? '') || QR_RE.test(el.description ?? '')) {
          altShapes.push({ objectId: el.objectId, pageObjectId: pageId, size: el.size, transform: el.transform });
        }
        if (el.elementGroup?.children) walk(el.elementGroup.children, pageId);
      }
    };
    for (const page of tplDoc.data.slides ?? []) walk(page.pageElements, page.objectId);
    const firstSlideId = tplDoc.data.slides?.[0]?.objectId as string | undefined;

    const results: { id: string; url?: string; error?: string; retryable?: boolean; name: string }[] = [];

    // deno-lint-ignore no-explicit-any
    async function processOne(r: any) {
      const lang = r.lang === 'en' ? 'en' : 'es';
      const vars = buildVars(event, r, schema, lang);
      const values: Record<string, string> = {};
      for (const [ph, m] of Object.entries(cfg.placeholder_map ?? {})) {
        if (m.source === 'field') values[ph] = vars[FIELD_TO_VAR[m.field ?? ''] ?? ''] ?? '';
        else if (m.source === 'question') values[ph] = vars[`q:${m.questionId}`] ?? '';
        else if (m.source === 'literal') values[ph] = m.value ?? '';
        else if (m.source === 'qr') values[ph] = r.qr_url ?? '';
        else values[ph] = '';
      }
      const baseName = sanitizeFileName(renderTemplate(cfg.file_name_template || '{{nombre}}', vars)) || 'invitacion';
      const fileName = `${baseName}-${String(r.id).slice(0, 6)}.${ext}`;
      const guestName = r.name ?? baseName;

      let copyId: string | null = null;
      try {
        const copy = await withRetry('copiar la plantilla', () =>
          drive.files.copy({ fileId: cfg.template_id, requestBody: { name: `TMP ${fileName}`, parents: [tmpFolderId as string] }, fields: 'id', supportsAllDrives: true }));
        copyId = copy.data.id as string;

        // deno-lint-ignore no-explicit-any
        const requests: any[] = Object.entries(values).map(([ph, v]) => ({
          replaceAllText: { containsText: { text: ph, matchCase: true }, replaceText: String(v ?? '') },
        }));
        if (r.qr_url) {
          requests.push({ replaceAllShapesWithImage: { containsText: { text: '{{qr}}', matchCase: false }, imageUrl: r.qr_url, imageReplaceMethod: 'CENTER_INSIDE' } });
          for (const s of altShapes) {
            requests.push({ createImage: { url: r.qr_url, elementProperties: { pageObjectId: s.pageObjectId, size: s.size, transform: s.transform } } });
            requests.push({ deleteObject: { objectId: s.objectId } });
          }
        } else {
          // Sin QR: limpiamos el marcador para que no salga el texto
          requests.push({ replaceAllText: { containsText: { text: '{{qr}}', matchCase: false }, replaceText: '' } });
        }
        if (requests.length) {
          await withRetry('personalizar la copia', () => slides.presentations.batchUpdate({ presentationId: copyId as string, requestBody: { requests } }));
        }

        await sleep(EXPORT_DELAY_MS);
        let bytes: Uint8Array;
        if (asPdf) {
          const pdf = await withRetry('exportar el PDF', () =>
            drive.files.export({ fileId: copyId as string, mimeType: 'application/pdf', supportsAllDrives: true }, { responseType: 'arraybuffer' }));
          bytes = new Uint8Array(pdf.data as ArrayBuffer);
          unwrapPdfLinks(bytes);
        } else {
          // Miniatura LARGE = 1600 px de ancho (2400 de alto en 2:3), PNG nítido para WhatsApp
          const thumb = await withRetry('exportar la imagen', () =>
            slides.presentations.pages.getThumbnail({
              presentationId: copyId as string, pageObjectId: firstSlideId as string,
              'thumbnailProperties.mimeType': 'PNG', 'thumbnailProperties.thumbnailSize': 'LARGE',
            }));
          const res = await fetch(thumb.data.contentUrl as string);
          if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
          bytes = new Uint8Array(await res.arrayBuffer());
        }

        // Si ya existe un archivo con ese nombre en Drive (regeneración), se reemplaza
        const prev = await drive.files.list({
          q: `'${escapeQ(outputFolderId as string)}' in parents and trashed=false and name='${escapeQ(fileName)}'`,
          fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true,
        });
        for (const f of prev.data.files ?? []) await trashFile(drive, f.id as string);
        if (r.invitation_drive_id) await trashFile(drive, r.invitation_drive_id);

        const uploaded = await withRetry('subir a Drive', () =>
          drive.files.create({
            requestBody: { name: fileName, mimeType: mime, parents: [outputFolderId as string] },
            media: { mimeType: mime, body: Readable.from([bytes]) },
            fields: 'id, webViewLink', supportsAllDrives: true,
          }));
        await trashFile(drive, copyId);

        let url: string;
        if (asPdf) {
          await withRetry('hacer público el PDF', () =>
            drive.permissions.create({ fileId: uploaded.data.id as string, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true }));
          url = uploaded.data.webViewLink as string;
        } else {
          // La URL que viaja al bot y al correo es la del bucket (directa y estable)
          const path = `${event.id}/invitations/${r.id}-${Date.now()}.png`;
          const { error: upErr } = await db.storage.from('event-assets').upload(path, bytes, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
          if (upErr) throw new Error(upErr.message);
          url = db.storage.from('event-assets').getPublicUrl(path).data.publicUrl;
          const old = bucketPath(r.invitation_url);
          if (old && old !== path) await db.storage.from('event-assets').remove([old]).catch(() => {});
        }
        await db.from('registrations').update({ invitation_url: url, invitation_drive_id: uploaded.data.id, invitation_drive_url: uploaded.data.webViewLink }).eq('id', r.id);
        results.push({ id: r.id, url, name: guestName });
      } catch (e) {
        const link = copyId ? ` (copia: https://docs.google.com/presentation/d/${copyId}/edit)` : '';
        const { message } = describeGoogleError(e, 'la plantilla o la carpeta', serviceAccountEmail);
        results.push({ id: r.id, name: guestName, error: `${message}${link}`, retryable: isRetryable(e) });
      }
    }

    // Dos a la vez: Slides tolera poco paralelismo
    for (let i = 0; i < batch.length; i += 2) {
      await Promise.all(batch.slice(i, i + 2).map(processOne));
    }

    // ── Contadores ────────────────────────────────────────────
    const okCount = results.filter(r => r.url).length;
    const newErrors = results.filter(r => r.error).map(r => ({ registration_id: r.id, name: r.name, message: r.error, retryable: r.retryable ?? false }));
    const remaining = pending.length - batch.length;
    const allErrors = [...((job.row_errors ?? []) as unknown[]), ...newErrors];
    const completed = remaining === 0;
    await db.from('invitation_jobs').update({
      processed_rows: (job.processed_rows ?? 0) + okCount,
      failed_rows: allErrors.length,
      row_errors: allErrors,
      last_error: newErrors[0]?.message ?? job.last_error,
      status: completed ? 'completed' : 'running',
      completed_at: completed ? new Date().toISOString() : null,
      lock_token: null, locked_at: null,
    }).eq('id', jobId);

    // ── Auto-encadenado: el siguiente lote no depende del navegador ──
    const stalled = okCount === 0 && newErrors.length > 0 && remaining > 0 && pending.length === batch.length;
    if (!completed && !stalled && CRON_SECRET && chainDepth < MAX_CHAIN_DEPTH) {
      const chain = fetch(`${SUPABASE_URL}/functions/v1/invitations-run-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ job_id: jobId, cron_secret: CRON_SECRET, chain_depth: chainDepth + 1 }),
      }).catch(() => {});
      // @ts-expect-error EdgeRuntime solo existe en el runtime de Supabase Edge Functions
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(chain);
      else await sleep(300);
    }

    return json({ ok: true, processed: okCount, failed: newErrors.length, remaining, completed });
  } catch (e) {
    const { code, message } = describeGoogleError(e, 'la plantilla o la carpeta', serviceAccountEmail);
    if (jobId) await db.from('invitation_jobs').update({ status: 'failed', last_error: message, lock_token: null, locked_at: null }).eq('id', jobId);
    return fail(code, message, { service_account_email: serviceAccountEmail });
  }
});
