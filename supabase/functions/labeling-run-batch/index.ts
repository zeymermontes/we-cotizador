// ─────────────────────────────────────────────────────────────
// labeling-run-batch — motor del rotulado.
//
// Procesa un LOTE de invitados (acotado por tiempo, no por número) y,
// si quedan pendientes, se vuelve a invocar a sí misma. Así el trabajo
// sigue aunque el admin cierre la pestaña.
//
// El Sheet es la fuente de verdad: "celda de URL vacía" = pendiente.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Readable } from "node:stream";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { unwrapPdfLinks } from "../_shared/pdf.ts";
import {
  a1,
  AppError,
  colLetter,
  describeGoogleError,
  escapeQ,
  extractPlaceholders,
  findFolderByName,
  findSingleFileByMime,
  getGoogleClients,
  MIME_SHEET,
  MIME_SLIDES,
  isRetryable,
  fixHyperlinks,
  norm,
  OUTPUT_FOLDER_NAME,
  sanitizeFileName,
  sleep,
  withRetry,
} from "../_shared/google.ts";

// Supabase mata al worker por CPU/memoria (WORKER_RESOURCE_LIMIT) mucho antes
// del límite de wall clock, así que cada invocación hace poco y encadena.
const DEFAULT_MAX_MS = 45_000;   // presupuesto de wall clock por lote
const HARD_MAX_MS = 60_000;
const TAIL_MARGIN_MS = 10_000;   // margen para write-back + update + respuesta
const MAX_ROWS_PER_BATCH = 6;    // tope duro de PDFs por invocación
const LOCK_TTL_MS = 2 * 60_000;  // un worker muerto se recupera en 2 min
const MAX_CHAIN_DEPTH = 400;     // tope de seguridad del auto-encadenado
const EXPORT_DELAY_MS = Number(Deno.env.get('EXPORT_DELAY_MS') ?? 1200);

interface RowJob {
  rowNumber: number;
  cells: string[];
  values: Record<string, string>;
  fileName: string;
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );
}

/** Resuelve los {{marcadores}} de una fila según placeholder_map. */
function resolveValues(job: any, headers: string[], cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ph, cfg] of Object.entries<any>(job.placeholder_map ?? {})) {
    if (cfg?.source === 'column') {
      const i = headers.findIndex((h) => norm(h) === norm(cfg.column ?? ''));
      out[ph] = i === -1 ? '' : String(cells[i] ?? '').trim();
    } else if (cfg?.source === 'typeform') {
      out[ph] = job.typeform_url ?? '';
    } else if (cfg?.source === 'literal') {
      out[ph] = String(cfg.value ?? '');
    } else {
      out[ph] = '';
    }
  }
  return out;
}

function renderTemplate(tpl: string, values: Record<string, string>): string {
  return (tpl || '{{nombre}}').replace(/\{\{[^{}]{1,80}\}\}/g, (m) => values[m] ?? '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const t0 = Date.now();
  const supabase = admin();
  let jobId: string | null = null;
  let serviceAccountEmail = '';

  try {
    const {
      job_id,
      run_token,
      max_ms = DEFAULT_MAX_MS,
      dry_run = false,
      dry_run_limit = 3,
      chain_depth = 0,
      reset = false,
    } = await req.json();

    jobId = job_id;
    if (!job_id || !run_token) throw new AppError('BAD_INPUT', 'Faltan job_id o run_token.');
    const budget = Math.min(Number(max_ms) || DEFAULT_MAX_MS, HARD_MAX_MS);

    // ── Lock cooperativo ───────────────────────────────────────
    if (!dry_run) {
      const staleBefore = new Date(Date.now() - LOCK_TTL_MS).toISOString();
      const { data: locked } = await supabase
        .from('labeling_jobs')
        .update({
          status: 'running',
          lock_token: run_token,
          locked_at: new Date().toISOString(),
        })
        .eq('id', job_id)
        .neq('status', 'paused')
        .or(`locked_at.is.null,locked_at.lt.${staleBefore},lock_token.eq.${run_token}`)
        .select()
        .maybeSingle();

      if (!locked) {
        const { data: cur } = await supabase.from('labeling_jobs').select('status').eq('id', job_id).maybeSingle();
        if (cur?.status === 'paused') {
          return json({ ok: true, status: 'paused', has_more: true, message: 'Pausado por el admin.' });
        }
        return fail('JOB_LOCKED', 'Este rotulado ya se está ejecutando. Espera a que termine el lote en curso.');
      }
    }

    const { data: job, error: jobErr } = await supabase
      .from('labeling_jobs')
      .select('*')
      .eq('id', job_id)
      .single();
    if (jobErr || !job) throw new AppError('JOB_NOT_FOUND', 'No encontré el rotulado.');

    if (!dry_run && job.status === 'paused') {
      return json({ ok: true, status: 'paused', has_more: true, message: 'Pausado por el admin.' });
    }
    if (!job.started_at && !dry_run) {
      await supabase.from('labeling_jobs').update({ started_at: new Date().toISOString() }).eq('id', job_id);
    }

    const g = getGoogleClients();
    serviceAccountEmail = g.serviceAccountEmail;
    const { drive, slides, sheets } = g;

    // ── Validar las fuentes antes de generar nada ─────────────
    // Se redescubren en la carpeta del evento: el admin pudo haber
    // reemplazado la hoja o la plantilla desde el último preflight.
    let spreadsheetId = job.spreadsheet_id as string | null;
    let templateId = job.template_id as string | null;

    if (reset || !spreadsheetId || !templateId) {
      if (!job.event_folder_id) {
        throw new AppError('BAD_INPUT', 'Este rotulado no tiene carpeta de evento. Vuelve a configurarlo.');
      }

      const sheetFile = await findSingleFileByMime(drive, job.event_folder_id, MIME_SHEET, 'la hoja de invitados');
      const tplFile = await findSingleFileByMime(drive, job.event_folder_id, MIME_SLIDES, 'la plantilla de la invitación');
      spreadsheetId = sheetFile.id;
      templateId = tplFile.id;

      const presentation = await withRetry('leer la plantilla', () =>
        slides.presentations.get({ presentationId: templateId as string }));
      const found = extractPlaceholders(presentation.data);

      if (!found.length) {
        throw new AppError(
          'NO_PLACEHOLDERS',
          `La plantilla "${tplFile.name}" no tiene ningún marcador {{...}}: todos los PDFs saldrían idénticos.`,
        );
      }

      const mapped = Object.keys(job.placeholder_map ?? {});
      const missing = mapped.filter((ph) => !found.includes(ph));
      if (missing.length) {
        throw new AppError(
          'PLACEHOLDER_MISMATCH',
          `La plantilla "${tplFile.name}" ya no tiene ${missing.join(', ')}. Abre Editar, dale a Validar y leer y revisa el mapeo.`,
        );
      }

      await supabase.from('labeling_jobs').update({
        spreadsheet_id: spreadsheetId,
        template_id: templateId,
      }).eq('id', job_id);
    }

    // ── Leer la hoja completa ─────────────────────────────────
    const sheetTitle = job.sheet_title || 'Hoja 1';
    const valuesRes = await withRetry('leer la hoja', () =>
      sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId as string,
        range: a1(sheetTitle, 'A1:ZZ'),
        majorDimension: 'ROWS',
      }));
    const rows: string[][] = (valuesRes.data.values ?? []) as string[][];
    const headers = (rows[job.header_row - 1] ?? []).map((h: string) => String(h ?? '').trim());

    // ── Asegurar la columna de write-back ─────────────────────
    let urlIdx = headers.findIndex((h) => norm(h) === norm(job.pdf_url_column));
    if (urlIdx === -1) {
      urlIdx = headers.length;
      await withRetry('crear la columna de URL', () =>
        sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId as string,
          range: a1(sheetTitle, `${colLetter(urlIdx)}${job.header_row}`),
          valueInputOption: 'RAW',
          requestBody: { values: [[job.pdf_url_column]] },
        }));
      headers[urlIdx] = job.pdf_url_column;
    }

    // ── Las columnas mapeadas tienen que seguir existiendo ────
    const missingCols = Object.entries<{ source?: string; column?: string }>(job.placeholder_map ?? {})
      .filter(([, cfg]) => cfg?.source === 'column')
      .filter(([, cfg]) => !headers.some((h) => norm(h) === norm(cfg.column ?? '')))
      .map(([ph, cfg]) => `${ph} → "${cfg.column}"`);
    if (missingCols.length) {
      throw new AppError(
        'COLUMN_MISSING',
        `La hoja ya no tiene las columnas del mapeo: ${missingCols.join(', ')}. Abre Editar, dale a Validar y leer y revisa el mapeo.`,
      );
    }

    // ── Regeneración: carpeta nueva y columna de URLs en blanco ──
    let outputFolderId = job.output_folder_id as string | null;

    if (reset) {
      // La carpeta anterior va a la papelera (recuperable 30 días), no se borra
      for (let i = 0; i < 5; i++) {
        const old = await findFolderByName(drive, job.event_folder_id, OUTPUT_FOLDER_NAME);
        if (!old) break;
        await drive.files.update({
          fileId: old.id,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        }).catch(() => {});
      }

      await withRetry('vaciar la columna de URLs', () =>
        sheets.spreadsheets.values.clear({
          spreadsheetId: spreadsheetId as string,
          range: a1(sheetTitle, `${colLetter(urlIdx)}${job.header_row + 1}:${colLetter(urlIdx)}`),
        }));
      for (let i = job.header_row; i < rows.length; i++) {
        if (rows[i]) rows[i][urlIdx] = '';
      }

      const fresh = await withRetry('crear la carpeta de salida', () =>
        drive.files.create({
          requestBody: {
            name: OUTPUT_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [job.event_folder_id],
          },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        }));
      outputFolderId = fresh.data.id as string;

      await supabase.from('labeling_jobs').update({
        output_folder_id: outputFolderId,
        output_folder_url: fresh.data.webViewLink,
        tmp_folder_id: null,
        processed_rows: 0,
        failed_rows: 0,
        row_errors: [],
        completed_at: null,
      }).eq('id', job_id);
      job.tmp_folder_id = null;
    }

    // ── Calcular pendientes ───────────────────────────────────
    const nameIdx = job.name_column
      ? headers.findIndex((h) => norm(h) === norm(job.name_column))
      : 0;
    const hasData = (cells: string[]) =>
      String(cells[nameIdx === -1 ? 0 : nameIdx] ?? '').trim() !== '';

    // Primero se resuelven todas las filas para poder detectar nombres repetidos:
    // el archivo se llama como el invitado (con acentos y símbolos), y solo si
    // hay dos iguales se desempata con el número de fila.
    const draft = [];
    for (let i = job.header_row; i < rows.length; i++) {
      const cells = rows[i] ?? [];
      if (!hasData(cells)) continue;
      const values = resolveValues(job, headers, cells);
      // El PDF se llama como el invitado. Si el patrón guardado no usa ningún
      // marcador que la plantilla tenga, renderTemplate sale vacío: se cae al
      // primer valor con contenido (normalmente el nombre) y luego a la columna
      // que identifica la fila.
      const base =
        sanitizeFileName(renderTemplate(job.file_name_template, values)) ||
        sanitizeFileName(Object.values(values).map((v) => String(v ?? '').trim()).find(Boolean) ?? '') ||
        sanitizeFileName(String(cells[nameIdx === -1 ? 0 : nameIdx] ?? '')) ||
        `Fila ${i + 1}`;
      draft.push({ rowNumber: i + 1, cells, values, base });
    }

    const nameCount = new Map<string, number>();
    for (const d of draft) nameCount.set(d.base, (nameCount.get(d.base) ?? 0) + 1);

    const all: RowJob[] = [];
    const pending: RowJob[] = [];
    for (const d of draft) {
      const unique = (nameCount.get(d.base) ?? 0) > 1 ? `${d.base} (fila ${d.rowNumber})` : d.base;
      const entry: RowJob = { rowNumber: d.rowNumber, cells: d.cells, values: d.values, fileName: `${unique}.pdf` };
      all.push(entry);
      if (String(d.cells[urlIdx] ?? '').trim() === '') pending.push(entry);
    }
    const total = all.length;
    const alreadyDone = total - pending.length;

    // ── Dry run: solo calcula, no toca Drive ──────────────────
    if (dry_run) {
      // Si ya no queda nada pendiente (todas las filas tienen URL), la vista
      // previa muestra igual las primeras filas: es lo que saldría al regenerar.
      const source = pending.length ? pending : all;
      const preview = source.slice(0, dry_run_limit).map((r) => ({
        row: r.rowNumber,
        file_name: r.fileName,
        values: r.values,
      }));
      return json({
        ok: true,
        dry_run: true,
        total,
        done: alreadyDone,
        remaining: pending.length,
        all_done: pending.length === 0,
        preview,
      });
    }

    if (!pending.length) {
      await supabase.from('labeling_jobs').update({
        status: 'completed',
        total_rows: total,
        processed_rows: total,
        completed_at: new Date().toISOString(),
        locked_at: null,
      }).eq('id', job_id);
      return json({ ok: true, status: 'completed', total, done: total, remaining: 0, has_more: false });
    }

    // ── Carpeta de salida (lotes encadenados: ya existe) ──────
    if (!outputFolderId) {
      let folder = await findFolderByName(drive, job.event_folder_id, OUTPUT_FOLDER_NAME);
      if (!folder) {
        const created = await withRetry('crear la carpeta de salida', () =>
          drive.files.create({
            requestBody: {
              name: OUTPUT_FOLDER_NAME,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [job.event_folder_id],
            },
            fields: 'id, webViewLink',
            supportsAllDrives: true,
          }));
        folder = { id: created.data.id as string, webViewLink: created.data.webViewLink as string };
      }
      outputFolderId = folder.id;
      await supabase.from('labeling_jobs').update({
        output_folder_id: outputFolderId,
        output_folder_url: folder.webViewLink,
      }).eq('id', job_id);
    }

    // ── Mapa de idempotencia: PDFs que ya existen en la carpeta ──
    const existing = new Map<string, string>();
    let pageToken: string | undefined = undefined;
    do {
      const res: any = await withRetry('listar la carpeta de salida', () =>
        drive.files.list({
          q: `'${escapeQ(outputFolderId as string)}' in parents and trashed=false and mimeType='application/pdf'`,
          fields: 'nextPageToken, files(id,name,webViewLink)',
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }));
      for (const f of res.data.files ?? []) existing.set(f.name, f.webViewLink);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    // ── Subcarpeta _tmp para las copias de Slides ─────────────
    let tmpFolderId = job.tmp_folder_id as string | null;
    if (!tmpFolderId) {
      const found = await withRetry('buscar la carpeta _tmp', () =>
        drive.files.list({
          q: `'${escapeQ(outputFolderId as string)}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='_tmp'`,
          fields: 'files(id)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }));
      tmpFolderId = found.data.files?.[0]?.id ?? null;
      if (!tmpFolderId) {
        const created = await withRetry('crear la carpeta _tmp', () =>
          drive.files.create({
            requestBody: { name: '_tmp', mimeType: 'application/vnd.google-apps.folder', parents: [outputFolderId as string] },
            fields: 'id',
            supportsAllDrives: true,
          }));
        tmpFolderId = created.data.id as string;
      }
      await supabase.from('labeling_jobs').update({ tmp_folder_id: tmpFolderId }).eq('id', job_id);
    }

    // ── Procesar una fila ─────────────────────────────────────
    async function processRow(r: RowJob) {
      const { values, fileName } = r;
      const guestName = fileName.replace(/\.pdf$/, '');

      // El PDF ya existe (el lote anterior murió antes del write-back)
      const already = existing.get(fileName);
      if (already) return { row: r.rowNumber, name: guestName, pdf_url: already, skipped: true };

      let copyId: string | null = null;
      try {
        const copy = await withRetry('copiar la plantilla', () =>
          drive.files.copy({
            fileId: templateId as string,
            requestBody: { name: `TMP ${fileName}`, parents: [tmpFolderId as string] },
            fields: 'id',
            supportsAllDrives: true,
          }));
        copyId = copy.data.id as string;

        const requests = Object.entries(values).map(([ph, v]) => ({
          replaceAllText: { containsText: { text: ph, matchCase: true }, replaceText: String(v ?? '') },
        }));
        if (requests.length) {
          await withRetry('personalizar la copia', () =>
            slides.presentations.batchUpdate({ presentationId: copyId as string, requestBody: { requests } }));
        }

        // Solo hace falta tocar los enlaces de la copia cuando alguna variable
        // trae una URL (para reapuntar por dominio). El redirector que mete
        // Google no vive aquí, sino en el PDF exportado: se quita más abajo.
        const urlValues = Object.values(values).filter((v) => /^https?:\/\//i.test(String(v ?? '')));
        if (urlValues.length) await fixHyperlinks(slides, copyId as string, urlValues);

        // Drive puede exportar una revisión anterior si no se le da un respiro
        await sleep(EXPORT_DELAY_MS);

        const pdf = await withRetry('exportar el PDF', () =>
          drive.files.export(
            { fileId: copyId as string, mimeType: 'application/pdf', supportsAllDrives: true },
            { responseType: 'arraybuffer' },
          ));

        // El export de Google envuelve cada enlace en google.com/url?q=…
        const pdfBytes = new Uint8Array(pdf.data as ArrayBuffer);
        unwrapPdfLinks(pdfBytes);

        const uploaded = await withRetry('subir el PDF', () =>
          drive.files.create({
            requestBody: { name: fileName, mimeType: 'application/pdf', parents: [outputFolderId as string] },
            media: { mimeType: 'application/pdf', body: Readable.from([pdfBytes]) },
            fields: 'id, webViewLink',
            supportsAllDrives: true,
          }));

        await withRetry('hacer público el PDF', () =>
          drive.permissions.create({
            fileId: uploaded.data.id as string,
            requestBody: { role: 'reader', type: 'anyone' },
            supportsAllDrives: true,
          }));

        if (!job.keep_slide_copies) {
          // En una unidad compartida la cuenta de servicio suele tener
          // canDelete=false; ahí el borrado falla y hay que mandar a papelera.
          await drive.files
            .delete({ fileId: copyId, supportsAllDrives: true })
            .catch(() =>
              drive.files
                .update({ fileId: copyId, requestBody: { trashed: true }, supportsAllDrives: true })
                .catch(() => {}));
        }

        const url = uploaded.data.webViewLink as string;
        existing.set(fileName, url);
        return { row: r.rowNumber, name: guestName, pdf_url: url };
      } catch (e: any) {
        // La copia se conserva a propósito cuando falla: sirve de evidencia
        const link = copyId ? ` (copia: https://docs.google.com/presentation/d/${copyId}/edit)` : '';
        const { message } = describeGoogleError(e, 'la plantilla o la carpeta', serviceAccountEmail);
        throw Object.assign(new Error(`${message}${link}`), { row: r.rowNumber, guest: guestName, retryable: isRetryable(e) });
      }
    }

    // ── Bucle del lote ────────────────────────────────────────
    const concurrency = Math.max(1, Math.min(6, job.concurrency ?? 2));
    const done: any[] = [];
    const errors: any[] = [];

    // El total se publica ANTES de procesar: si el worker muere, la barra de
    // progreso ya sabe cuántos invitados hay y cuántos llevaba.
    await supabase.from('labeling_jobs').update({
      total_rows: total,
      processed_rows: alreadyDone,
    }).eq('id', job_id);

    while (
      pending.length &&
      done.length + errors.length < MAX_ROWS_PER_BATCH &&
      Date.now() - t0 < budget - TAIL_MARGIN_MS
    ) {
      const chunk = pending.splice(0, concurrency);
      const settled = await Promise.allSettled(chunk.map(processRow));

      const ok: any[] = [];
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled') {
          ok.push(s.value);
          done.push(s.value);
        } else {
          const err: any = s.reason;
          errors.push({
            row: err?.row ?? chunk[i].rowNumber,
            name: err?.guest ?? '',
            message: String(err?.message ?? err).slice(0, 500),
            retryable: err?.retryable ?? false,
          });
        }
      });

      // Write-back por chunk: acota el daño si la función muere a medio lote
      if (ok.length) {
        await withRetry('escribir las URLs en la hoja', () =>
          sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: spreadsheetId as string,
            requestBody: {
              valueInputOption: 'RAW',
              data: ok.map((r) => ({
                range: a1(sheetTitle, `${colLetter(urlIdx)}${r.row}`),
                values: [[r.pdf_url]],
              })),
            },
          }));
      }

      // Progreso incremental: sin esto la barra no se mueve hasta terminar el
      // lote, y si el worker muere no queda rastro de lo que sí se generó.
      await supabase.from('labeling_jobs').update({
        processed_rows: alreadyDone + done.length,
        failed_rows: errors.length,
        row_errors: errors.slice(0, 200),
      }).eq('id', job_id);
    }

    const remaining = pending.length + errors.length;
    // Si el lote no logró NI UNA fila, encadenar solo repetiría el mismo error
    const stalled = done.length === 0 && errors.length > 0;
    const hasMore = remaining > 0 && !stalled && chain_depth < MAX_CHAIN_DEPTH;

    // ── Persistir progreso ────────────────────────────────────
    const { data: fresh } = await supabase.from('labeling_jobs').select('status').eq('id', job_id).single();
    const paused = fresh?.status === 'paused';

    await supabase.from('labeling_jobs').update({
      status: paused ? 'paused' : remaining === 0 ? 'completed' : stalled ? 'failed' : 'running',
      total_rows: total,
      processed_rows: alreadyDone + done.length,
      failed_rows: errors.length,
      row_errors: errors.slice(0, 200),
      last_error: stalled ? errors[0]?.message ?? null : null,
      completed_at: remaining === 0 ? new Date().toISOString() : null,
      locked_at: null,
    }).eq('id', job_id);

    // ── Auto-encadenado: el siguiente lote no depende del navegador ──
    if (hasMore && !paused) {
      const chain = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/labeling-run-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ job_id, run_token, max_ms: budget, chain_depth: chain_depth + 1 }),
      }).catch(() => {});

      // @ts-expect-error EdgeRuntime solo existe en el runtime de Supabase Edge Functions
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(chain);
      else await sleep(400);
    }

    return json({
      ok: true,
      job_id,
      status: paused ? 'paused' : remaining === 0 ? 'completed' : stalled ? 'failed' : 'running',
      total,
      done: alreadyDone + done.length,
      failed: errors.length,
      remaining,
      has_more: hasMore && !paused,
      batch: { succeeded: done.length, elapsed_ms: Date.now() - t0, results: done.slice(0, 50), errors: errors.slice(0, 50) },
    });
  } catch (e: any) {
    const { code, message } = describeGoogleError(e, 'los archivos de Google', serviceAccountEmail);
    if (jobId) {
      await supabase.from('labeling_jobs').update({
        status: 'failed',
        last_error: message,
        locked_at: null,
      }).eq('id', jobId).then(() => {}, () => {});
    }
    return fail(code, message);
  }
});
