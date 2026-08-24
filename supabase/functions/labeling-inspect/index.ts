// ─────────────────────────────────────────────────────────────
// labeling-inspect — descubrimiento y preflight del rotulado.
//
// Lee (sin escribir nada) el Sheet, la plantilla de Slides y la
// carpeta de salida, y devuelve encabezados, marcadores {{...}} y
// un mapeo sugerido para que el admin lo confirme.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import {
  a1,
  AppError,
  describeGoogleError,
  extractPlaceholders,
  findFolderByName,
  getGoogleClients,
  getRotuladoRootFolderId,
  norm,
  parseGoogleId,
  sanitizeFolderName,
} from "../_shared/google.ts";

const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';
const MIME_SLIDES = 'application/vnd.google-apps.presentation';
const MIME_FOLDER = 'application/vnd.google-apps.folder';

const LINK_HINT = /(link|typeform|rsvp|formulario|confirmac|url)/;

const MY_DRIVE_WARNING =
  'La carpeta raíz está en "Mi unidad". Los PDFs quedarán a nombre de la cuenta de servicio y consumirán su cuota, que es casi nula. Se recomienda una Unidad compartida.';

/** Alias por si el encabezado no se llama igual que el marcador. */
const ALIASES: Record<string, string[]> = {
  nombre: ['nombre', 'invitado', 'guest', 'name', 'nombrecompleto', 'nombreinvitado'],
  apellido: ['apellido', 'apellidos', 'lastname'],
  mesa: ['mesa', 'table', 'nomesa'],
  pases: ['pases', 'pase', 'boletos', 'lugares', 'tickets', 'cantidad', 'acompanantes'],
  telefono: ['telefono', 'celular', 'whatsapp', 'phone', 'tel'],
};

function suggestMapping(placeholders: string[], headers: string[], hasTypeform: boolean) {
  const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
  const map: Record<string, { source: string; column?: string; value?: string }> = {};

  for (const ph of placeholders) {
    const inner = norm(ph.replace(/[{}]/g, ''));

    if (hasTypeform && LINK_HINT.test(inner)) {
      map[ph] = { source: 'typeform' };
      continue;
    }

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

    map[ph] = hit ? { source: 'column', column: hit.raw } : { source: 'empty' };
  }
  return map;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let serviceAccountEmail = '';
  let step = 'config';

  try {
    const body = await req.json();
    const {
      spreadsheet_url,
      sheet_title = null,
      header_row = 1,
      template_url,
      output_folder_name = '',
      output_folder_id = null,
      typeform_url = '',
    } = body ?? {};

    const g = getGoogleClients();
    serviceAccountEmail = g.serviceAccountEmail;
    const { drive, slides, sheets } = g;

    const warnings: string[] = [];

    // ── 1. Hoja de cálculo ───────────────────────────────────
    step = 'sheet';
    const sheetRef = parseGoogleId(spreadsheet_url, 'la hoja de cálculo');
    const sheetFile = await drive.files.get({
      fileId: sheetRef.id,
      fields: 'id,name,mimeType,capabilities(canEdit)',
      supportsAllDrives: true,
    });
    if (sheetFile.data.mimeType !== MIME_SHEET) {
      throw new AppError('BAD_INPUT', 'Ese enlace no es una hoja de cálculo de Google.');
    }
    if (!sheetFile.data.capabilities?.canEdit) {
      throw new AppError(
        'PERMISSION_DENIED',
        `Puedo leer la hoja pero no escribir en ella. Comparte "${sheetFile.data.name}" con ${serviceAccountEmail} como Editor: necesito escribir la URL de cada PDF de vuelta.`,
      );
    }

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetRef.id,
      fields: 'properties.title,sheets.properties(sheetId,title,gridProperties(rowCount))',
    });
    const tabs = (meta.data.sheets ?? []).map((s: any) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount ?? 0,
    }));
    if (!tabs.length) throw new AppError('BAD_INPUT', 'La hoja de cálculo no tiene ninguna pestaña.');

    const selectedTab =
      tabs.find((t: any) => t.title === sheet_title) ??
      (sheetRef.gid != null ? tabs.find((t: any) => t.sheetId === sheetRef.gid) : undefined) ??
      tabs[0];

    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetRef.id,
      range: a1(selectedTab.title, 'A1:ZZ'),
      majorDimension: 'ROWS',
    });
    const rows: string[][] = (valuesRes.data.values ?? []) as string[][];
    const headers = (rows[header_row - 1] ?? []).map((h) => String(h ?? '').trim());
    if (!headers.filter(Boolean).length) {
      throw new AppError('BAD_INPUT', `La fila ${header_row} de "${selectedTab.title}" está vacía; ahí esperaba los encabezados.`);
    }

    const dataRows = rows.slice(header_row);
    const nonEmpty = dataRows.filter((r) => (r ?? []).some((c) => String(c ?? '').trim() !== ''));
    const pdfUrlColIndex = headers.findIndex((h) => norm(h) === norm('PDF URL'));

    // ── 2. Plantilla de Slides ───────────────────────────────
    step = 'template';
    const tplRef = parseGoogleId(template_url, 'la plantilla');
    const tplFile = await drive.files.get({
      fileId: tplRef.id,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });
    if (tplFile.data.mimeType !== MIME_SLIDES) {
      throw new AppError('BAD_INPUT', 'Ese enlace no es una presentación de Google Slides.');
    }
    const presentation = await slides.presentations.get({ presentationId: tplRef.id });
    const placeholders = extractPlaceholders(presentation.data);
    if (!placeholders.length) {
      warnings.push(
        'La plantilla no contiene ningún marcador {{...}}. Revisa que el texto no esté partido por cambios de formato dentro del mismo cuadro.',
      );
    }
    const slideCount = (presentation.data.slides ?? []).length;
    if (slideCount > 1) warnings.push(`La plantilla tiene ${slideCount} diapositivas: cada PDF tendrá ${slideCount} páginas.`);

    // ── 3. Carpeta de salida ─────────────────────────────────
    // No se crea aquí: solo se valida. La carpeta nace en la primera
    // generación, para que un borrador abandonado no deje basura en Drive.
    step = 'folder';
    let folderInfo: Record<string, unknown>;

    if (output_folder_id) {
      // Job ya ejecutado: la carpeta existe, solo confirmamos que sigue accesible
      const folder = await drive.files.get({
        fileId: output_folder_id,
        fields: 'id,name,mimeType,driveId,webViewLink,capabilities(canAddChildren)',
        supportsAllDrives: true,
      });
      if (folder.data.mimeType !== MIME_FOLDER) throw new AppError('BAD_INPUT', 'La carpeta de salida guardada ya no es una carpeta.');
      if (!folder.data.capabilities?.canAddChildren) {
        throw new AppError('PERMISSION_DENIED', `Ya no puedo crear archivos en la carpeta "${folder.data.name}".`);
      }
      folderInfo = {
        id: folder.data.id,
        name: folder.data.name,
        url: folder.data.webViewLink,
        exists: true,
        is_shared_drive: !!folder.data.driveId,
      };
      if (!folder.data.driveId) warnings.push(MY_DRIVE_WARNING);
    } else {
      const cleanName = sanitizeFolderName(output_folder_name);
      if (!cleanName) throw new AppError('BAD_INPUT', 'Escribe un nombre para la carpeta de salida.');

      const rootId = getRotuladoRootFolderId();
      const root = await drive.files.get({
        fileId: rootId,
        fields: 'id,name,driveId,capabilities(canAddChildren)',
        supportsAllDrives: true,
      });
      if (!root.data.capabilities?.canAddChildren) {
        throw new AppError(
          'PERMISSION_DENIED',
          `${serviceAccountEmail} no puede crear carpetas dentro de la carpeta raíz de Drive.`,
        );
      }

      const duplicate = await findFolderByName(drive, rootId, cleanName);
      if (duplicate) {
        return fail(
          'FOLDER_EXISTS',
          `Ya existe una carpeta llamada "${cleanName}" en ${root.data.name}. Usa otro nombre para no mezclar los PDFs de dos eventos.`,
          { step: 'folder', service_account_email: serviceAccountEmail, existing_folder_url: duplicate.webViewLink },
        );
      }

      folderInfo = {
        id: null,
        name: cleanName,
        url: null,
        exists: false,
        parent_name: root.data.name,
        is_shared_drive: !!root.data.driveId,
      };
      if (!root.data.driveId) warnings.push(MY_DRIVE_WARNING);
    }

    return json({
      ok: true,
      service_account_email: serviceAccountEmail,
      spreadsheet: {
        id: sheetRef.id,
        title: sheetFile.data.name,
        tabs,
        selected_tab: selectedTab.title,
        headers,
        sample_rows: nonEmpty.slice(0, 5),
        data_row_count: nonEmpty.length,
        pdf_url_column_index: pdfUrlColIndex === -1 ? null : pdfUrlColIndex,
      },
      template: { id: tplRef.id, title: tplFile.data.name, placeholders, slide_count: slideCount },
      folder: folderInfo,
      suggested_map: suggestMapping(placeholders, headers, !!typeform_url),
      warnings,
    });
  } catch (e: any) {
    const what =
      step === 'sheet' ? 'la hoja de cálculo' : step === 'template' ? 'la plantilla' : step === 'folder' ? 'la carpeta de salida' : 'la configuración';
    const { code, message } = describeGoogleError(e, what, serviceAccountEmail);
    return fail(code, message, { step, service_account_email: serviceAccountEmail });
  }
});
