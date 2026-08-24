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
import {
  a1,
  AppError,
  collectLinks,
  registrableDomain,
  describeGoogleError,
  extractPlaceholders,
  findSingleFileByMime,
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
    const { event_folder_url, sheet_title = null, header_row = 1 } = body ?? {};

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
    const links = collectLinks(presentation.data);

    // Un enlace por dominio, quedándose con dónde vive (texto, forma o imagen)
    const byDomain = new Map<string, { domain: string; kind: string; url: string }>();
    for (const l of links) {
      const domain = registrableDomain(l.url);
      if (domain && !byDomain.has(domain)) byDomain.set(domain, { domain, kind: l.kind, url: l.url });
    }
    const linkDomains = [...byDomain.values()];

    return json({
      ok: true,
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
        link_domains: linkDomains,
      },
      output_folder_name: OUTPUT_FOLDER_NAME,
      suggested_map: suggestMapping(placeholders, headers),
      warnings,
    });
  } catch (e) {
    const what =
      step === 'folder' ? 'la carpeta del evento' : step === 'sheet' ? 'la hoja de invitados' : step === 'template' ? 'la plantilla' : 'la configuración';
    const { code, message } = describeGoogleError(e, what, serviceAccountEmail);
    return fail(code, message, { step, service_account_email: serviceAccountEmail });
  }
});
