// ─────────────────────────────────────────────────────────────
// labeling-inspect — descubrimiento y preflight del rotulado.
//
// Recibe UNA sola cosa: el enlace de la carpeta del evento. Dentro
// busca la hoja de invitados y la presentación que hace de plantilla
// (el nombre da igual, pero tiene que haber exactamente una de cada),
// y devuelve encabezados, marcadores {{...}} y un mapeo sugerido.
//
// No escribe nada en Drive: la subcarpeta de salida se crea al generar.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { unwrapPdfLinks } from "../_shared/pdf.ts";
import {
  a1,
  AppError,
  collectLinks,
  registrableDomain,
  describeGoogleError,
  extractPlaceholders,
  findSingleFileByMime,
  fixHyperlinks,
  getGoogleClients,
  MIME_FOLDER,
  MIME_SHEET,
  MIME_SLIDES,
  norm,
  OUTPUT_FOLDER_NAME,
  parseGoogleId,
} from "../_shared/google.ts";

const MY_DRIVE_WARNING =
  'La carpeta del evento está en "Mi unidad". Los PDFs quedarán a nombre de la cuenta de servicio y consumirán su cuota, que es casi nula. Se recomienda una Unidad compartida.';

/** Alias por si el encabezado no se llama igual que el marcador. */
const ALIASES: Record<string, string[]> = {
  nombre: ['nombre', 'invitado', 'guest', 'name', 'nombrecompleto', 'nombreinvitado'],
  apellido: ['apellido', 'apellidos', 'lastname'],
  mesa: ['mesa', 'table', 'nomesa'],
  pases: ['pases', 'pase', 'boletos', 'lugares', 'tickets', 'cantidad', 'acompanantes'],
  telefono: ['telefono', 'celular', 'whatsapp', 'phone', 'tel'],
};

/**
 * Cada marcador se ata a una columna si el nombre cuadra. Los que no cuadran
 * quedan como "valor fijo" vacío: son las variables que el admin tiene que
 * llenar en el formulario.
 */
/**
 * Dónde escribir la URL del PDF. Se prefiere una columna que ya exista en la
 * hoja antes que crear otra: si el admin ya tiene una llamada "url", esa es.
 */
function suggestUrlColumn(headers: string[]): string {
  const present = headers.filter(Boolean);
  const exact = present.find((h) => norm(h) === 'url');
  if (exact) return exact;
  const pdfish = present.find((h) => norm(h).includes('pdf'));
  if (pdfish) return pdfish;
  const linkish = present.find((h) => norm(h).includes('link'));
  if (linkish) return linkish;
  return 'PDF URL';
}

function suggestMapping(placeholders: string[], headers: string[]) {
  const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
  const map: Record<string, { source: string; column?: string; value?: string }> = {};

  for (const ph of placeholders) {
    const inner = norm(ph.replace(/[{}]/g, ''));

    let hit = normHeaders.find((h) => h.n === inner);
    if (!hit) hit = normHeaders.find((h) => h.n && (h.n.startsWith(inner) || inner.startsWith(h.n)));
    if (!hit) hit = normHeaders.find((h) => h.n && (h.n.includes(inner) || inner.includes(h.n)));

    if (!hit) {
      for (const [key, aliases] of Object.entries(ALIASES)) {
        if (inner === key || aliases.includes(inner)) {
          hit = normHeaders.find((h) => aliases.includes(h.n));
          if (hit) break;
        }
      }
    }

    map[ph] = hit ? { source: 'column', column: hit.raw } : { source: 'literal', value: '' };
  }
  return map;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let serviceAccountEmail = '';
  let step = 'config';

  try {
    const body = await req.json();
    const { event_folder_url, sheet_title = null, header_row = 1, probe_links = false } = body ?? {};

    const g = getGoogleClients();
    serviceAccountEmail = g.serviceAccountEmail;
    const { drive, slides, sheets } = g;

    const warnings: string[] = [];

    // ── 1. La carpeta del evento ─────────────────────────────
    step = 'folder';
    const folderRef = parseGoogleId(event_folder_url, 'la carpeta del evento');
    const folder = await drive.files.get({
      fileId: folderRef.id,
      fields: 'id,name,mimeType,driveId,webViewLink,capabilities(canAddChildren)',
      supportsAllDrives: true,
    });
    if (folder.data.mimeType !== MIME_FOLDER) {
      throw new AppError('BAD_INPUT', 'Ese enlace no es una carpeta de Drive.');
    }
    if (!folder.data.capabilities?.canAddChildren) {
      throw new AppError(
        'PERMISSION_DENIED',
        `Tengo acceso a "${folder.data.name}" pero no puedo crear nada dentro. Comparte la carpeta con ${serviceAccountEmail} como Editor.`,
      );
    }
    if (!folder.data.driveId) warnings.push(MY_DRIVE_WARNING);

    // Restos de un diagnóstico anterior: se limpian antes de nada, si no
    // el descubrimiento vería dos presentaciones en la carpeta.
    const strays = await drive.files.list({
      q: `'${folderRef.id}' in parents and trashed=false and name='PROBE enlaces'`,
      fields: 'files(id,capabilities(canDelete,canTrash))',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const strayReport: string[] = [];
    for (const f of strays.data.files ?? []) {
      strayReport.push(`canDelete=${f.capabilities?.canDelete} canTrash=${f.capabilities?.canTrash}`);
      try {
        await drive.files.delete({ fileId: f.id, supportsAllDrives: true });
      } catch (e) {
        strayReport.push(`delete falló: ${(e as Error).message}`);
        try {
          await drive.files.update({ fileId: f.id, requestBody: { trashed: true }, supportsAllDrives: true });
        } catch (e2) {
          strayReport.push(`trash falló: ${(e2 as Error).message}`);
        }
      }
    }
    if (strayReport.length) warnings.push(`Limpieza de PROBE: ${strayReport.join(' | ')}`);

    // ── 2. La hoja de invitados ──────────────────────────────
    step = 'sheet';
    const sheetFile = await findSingleFileByMime(drive, folderRef.id, MIME_SHEET, 'la hoja de invitados');

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetFile.id,
      fields: 'properties.title,sheets.properties(sheetId,title,gridProperties(rowCount))',
    });
    const tabs = (meta.data.sheets ?? []).map((s: { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number } } }) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount ?? 0,
    }));
    if (!tabs.length) throw new AppError('BAD_INPUT', 'La hoja de invitados no tiene ninguna pestaña.');

    const selectedTab = tabs.find((t: { title: string }) => t.title === sheet_title) ?? tabs[0];

    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetFile.id,
      range: a1(selectedTab.title, 'A1:ZZ'),
      majorDimension: 'ROWS',
    });
    const rows: string[][] = (valuesRes.data.values ?? []) as string[][];
    const headers = (rows[header_row - 1] ?? []).map((h) => String(h ?? '').trim());
    if (!headers.filter(Boolean).length) {
      throw new AppError(
        'BAD_INPUT',
        `La fila ${header_row} de "${selectedTab.title}" está vacía; ahí esperaba los encabezados.`,
      );
    }

    const dataRows = rows.slice(header_row);
    const nonEmpty = dataRows.filter((r) => (r ?? []).some((c) => String(c ?? '').trim() !== ''));

    // ── 3. La plantilla ──────────────────────────────────────
    step = 'template';
    const tplFile = await findSingleFileByMime(drive, folderRef.id, MIME_SLIDES, 'la plantilla de la invitación');
    const presentation = await slides.presentations.get({ presentationId: tplFile.id });
    const placeholders = extractPlaceholders(presentation.data);

    if (!placeholders.length) {
      throw new AppError(
        'NO_PLACEHOLDERS',
        `La plantilla "${tplFile.name}" no tiene ningún marcador {{...}}. Sin marcadores todos los PDFs saldrían idénticos. Revisa también que el texto del marcador no esté partido por cambios de formato.`,
      );
    }

    const slideCount = (presentation.data.slides ?? []).length;
    if (slideCount > 1) warnings.push(`La plantilla tiene ${slideCount} diapositivas: cada PDF tendrá ${slideCount} páginas.`);

    // ── 4. Enlaces que ya trae la plantilla ──────────────────
    // Si alguna variable es una URL del mismo dominio, ese enlace se reapunta.
    // Ya vienen sin el redirector google.com/url. Se deduplican por destino,
    // conservando dónde vive cada uno (texto, forma o imagen).
    const seenLinks = new Set<string>();
    const links = collectLinks(presentation.data)
      .filter((l) => {
        const key = `${l.kind}|${l.url}`;
        if (seenLinks.has(key)) return false;
        seenLinks.add(key);
        return true;
      })
      .map((l) => ({ ...l, domain: registrableDomain(l.url) }))
      .slice(0, 30);

    // Diagnóstico opcional: copia la plantilla, le aplica el arreglo de
    // enlaces y devuelve el antes/después. La copia se borra al terminar.
    let probe = null;
    if (probe_links) {
      const copy = await drive.files.copy({
        fileId: tplFile.id,
        requestBody: { name: 'PROBE enlaces', parents: [folderRef.id] },
        fields: 'id',
        supportsAllDrives: true,
      });
      const copyId = copy.data.id as string;
      try {
        const failures = await fixHyperlinks(slides, copyId, []);
        const after = await slides.presentations.get({ presentationId: copyId });

        // ¿El redirector lo mete el export a PDF, y no el archivo?
        await new Promise((r) => setTimeout(r, 1500));
        const pdf = await drive.files.export(
          { fileId: copyId, mimeType: 'application/pdf', supportsAllDrives: true },
          { responseType: 'arraybuffer' },
        );
        const bytes = new Uint8Array(pdf.data as ArrayBuffer);
        const sizeBefore = bytes.length;
        const readUris = () => {
          let t = '';
          for (let i = 0; i < bytes.length; i++) t += String.fromCharCode(bytes[i]);
          return [...t.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1]);
        };
        const urisBefore = readUris();
        const rewritten = unwrapPdfLinks(bytes);
        const urisAfter = readUris();

        probe = {
          failures,
          before: links.map((l) => l.raw),
          after: collectLinks(after.data).map((l) => l.raw),
          pdf_size_stable: sizeBefore === bytes.length,
          pdf_rewritten: rewritten,
          pdf_wrapped_before: urisBefore.filter((u) => u.includes('google.com/url')).length,
          pdf_wrapped_after: urisAfter.filter((u) => u.includes('google.com/url')).length,
          pdf_uris_after: urisAfter.slice(0, 4),
        };
      } finally {
        await drive.files.delete({ fileId: copyId, supportsAllDrives: true }).catch(() => {});
      }
    }

    return json({
      ok: true,
      probe,
      service_account_email: serviceAccountEmail,
      event_folder: { id: folderRef.id, name: folder.data.name, url: folder.data.webViewLink },
      spreadsheet: {
        id: sheetFile.id,
        title: sheetFile.name,
        tabs,
        selected_tab: selectedTab.title,
        headers,
        sample_rows: nonEmpty.slice(0, 5),
        data_row_count: nonEmpty.length,
      },
      template: {
        id: tplFile.id,
        title: tplFile.name,
        placeholders,
        slide_count: slideCount,
        link_count: links.length,
        links,
      },
      output_folder_name: OUTPUT_FOLDER_NAME,
      suggested_map: suggestMapping(placeholders, headers),
      suggested_url_column: suggestUrlColumn(headers),
      warnings,
    });
  } catch (e) {
    const what =
      step === 'folder' ? 'la carpeta del evento' : step === 'sheet' ? 'la hoja de invitados' : step === 'template' ? 'la plantilla' : 'la configuración';
    const { code, message } = describeGoogleError(e, what, serviceAccountEmail);
    return fail(code, message, { step, service_account_email: serviceAccountEmail });
  }
});
