// Carpetas de Drive por evento y utilidades pequeñas que comparten las
// funciones de invitaciones (crear plantilla, generar, copiar a Drive).
import { findFolderByName, withRetry } from "./google.ts";

export const ROOT_FOLDER_ID = Deno.env.get('EVENTS_ROOT_FOLDER_ID') ?? '';

export const safeName = (s: string) => (s || 'evento').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// deno-lint-ignore no-explicit-any
export async function ensureFolder(drive: any, parentId: string, name: string): Promise<{ id: string; webViewLink: string }> {
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

export interface EventFolderRow { id: string; name: string; slug: string; drive_folder_id: string | null; drive_folder_url: string | null }

/** Carpeta "<raíz>/<nombre del evento>", creada una sola vez y guardada en events. */
// deno-lint-ignore no-explicit-any
export async function ensureEventFolder(db: any, drive: any, event: EventFolderRow, serviceAccountEmail: string): Promise<{ id: string; url: string }> {
  if (event.drive_folder_id) return { id: event.drive_folder_id, url: event.drive_folder_url ?? `https://drive.google.com/drive/folders/${event.drive_folder_id}` };
  if (!ROOT_FOLDER_ID) {
    throw Object.assign(new Error(`Falta la carpeta raíz de eventos en Drive: crea una, compártela con ${serviceAccountEmail} y guarda su id como EVENTS_ROOT_FOLDER_ID.`), { code: 'CONFIG' });
  }
  const f = await ensureFolder(drive, ROOT_FOLDER_ID, safeName(event.name) || event.slug);
  await db.from('events').update({ drive_folder_id: f.id, drive_folder_url: f.webViewLink }).eq('id', event.id);
  return { id: f.id, url: f.webViewLink };
}

// deno-lint-ignore no-explicit-any
export async function trashFile(drive: any, fileId: string) {
  await drive.files.delete({ fileId, supportsAllDrives: true }).catch(() =>
    drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true }).catch(() => {}));
}

/** Ancho y alto de un PNG, JPEG, WebP o GIF leyendo solo la cabecera. */
export function imageDims(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (b.length > 30 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (tag === 'VP8L') { const bits = dv.getUint32(21, true); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
    if (tag === 'VP8X') return { width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return null;
}
