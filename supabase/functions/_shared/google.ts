import { google } from "npm:googleapis@133";

/**
 * Scopes del rotulado. `spreadsheets` (lectura + escritura) es nuevo
 * respecto a generate-quotation: hace falta para escribir la URL del
 * PDF de vuelta en cada fila.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/spreadsheets',
];

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

export function getGoogleClients() {
  const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new AppError('CONFIG', 'Faltan las credenciales de Google en las variables de entorno del proyecto.');
  }

  const auth = new google.auth.JWT(clientEmail, null, privateKey, SCOPES);

  return {
    serviceAccountEmail: clientEmail,
    drive: google.drive({ version: 'v3', auth }),
    slides: google.slides({ version: 'v1', auth }),
    sheets: google.sheets({ version: 'v4', auth }),
  };
}

/** Acepta un ID pelado o cualquier URL de Sheets / Slides / Drive. */
export function parseGoogleId(input: string, label: string): { id: string; gid?: number } {
  const s = (input ?? '').trim();
  if (!s) throw new AppError('BAD_INPUT', `Falta ${label}.`);

  const gid = s.match(/[#&?]gid=(\d+)/)?.[1];
  const m =
    s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) ||        // /d/<id>/edit
    s.match(/\/folders\/([a-zA-Z0-9_-]{15,})/) ||  // /drive/folders/<id>
    s.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);        // ?id=<id>

  const id = m ? m[1] : (/^[a-zA-Z0-9_-]{15,}$/.test(s) ? s : '');
  if (!id) {
    throw new AppError('BAD_INPUT', `El enlace de ${label} no parece de Google. Pega la URL completa o el ID.`);
  }
  return { id, gid: gid ? Number(gid) : undefined };
}

/** Escapa el valor para el parámetro `q` de la API de Drive. */
export const escapeQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function isRetryable(e: any): boolean {
  const status = Number(e?.code ?? e?.response?.status);
  const reason = e?.errors?.[0]?.reason ?? e?.response?.data?.error?.errors?.[0]?.reason ?? '';
  return RETRYABLE_STATUS.has(status) || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
}

/** Reintenta con backoff exponencial + jitter. 403/404 fallan de inmediato. */
export async function withRetry<T>(label: string, fn: () => Promise<T>, retries = 4): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isRetryable(e)) throw new AppError('GOOGLE_ERROR', `${label}: ${e?.message ?? e}`, false);
      if (attempt === retries) break;
      const wait = Math.min(20_000, 500 * 2 ** attempt * (0.5 + Math.random()));
      await sleep(wait);
    }
  }
  throw new AppError('GOOGLE_RATE_LIMIT', `${label}: se agotaron los reintentos — ${lastErr?.message}`, true);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Recorre slides, layouts, tablas y grupos y devuelve los {{marcadores}} únicos. */
export function extractPlaceholders(presentation: any): string[] {
  const found = new Set<string>();
  const re = /\{\{[^{}]{1,80}\}\}/g;

  const walkText = (t: any) => {
    for (const el of t?.textElements ?? []) {
      const c = el?.textRun?.content;
      if (c) for (const m of c.matchAll(re)) found.add(m[0]);
    }
  };

  const walkElements = (els: any[] = []) => {
    for (const el of els) {
      if (el.shape?.text) walkText(el.shape.text);
      if (el.table?.tableRows) {
        for (const row of el.table.tableRows) {
          for (const cell of row.tableCells ?? []) walkText(cell.text);
        }
      }
      if (el.elementGroup?.children) walkElements(el.elementGroup.children);
    }
  };

  for (const page of [...(presentation?.slides ?? []), ...(presentation?.layouts ?? [])]) {
    walkElements(page.pageElements);
  }
  return [...found];
}

/** 0 → "A", 25 → "Z", 26 → "AA" */
export function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - r - 1) / 26;
  }
  return s;
}

/** Rango A1 con el título de la hoja correctamente citado. */
export const a1 = (sheetTitle: string, ref: string) => `'${sheetTitle.replace(/'/g, "''")}'!${ref}`;

/** "Diseño " y "{{diseno}}" colapsan al mismo valor. */
export const norm = (s: string) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Nombre de archivo seguro para Drive. */
export const sanitizeFileName = (s: string) =>
  (s ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

/**
 * Traduce un error de googleapis a un código propio con mensaje accionable.
 * `what` describe el recurso ("la hoja de cálculo", "la plantilla"…).
 */
export function describeGoogleError(e: any, what: string, serviceAccountEmail: string) {
  if (e instanceof AppError) return { code: e.code, message: e.message };

  const status = Number(e?.code ?? e?.response?.status);
  const reason = e?.errors?.[0]?.reason ?? e?.response?.data?.error?.errors?.[0]?.reason ?? '';

  if (status === 404) {
    return {
      code: 'NOT_FOUND',
      message: `No encuentro ${what}. Puede que el enlace esté mal, que el archivo esté en la papelera o que ${serviceAccountEmail} no tenga acceso.`,
    };
  }
  if (status === 403 && reason === 'accessNotConfigured') {
    return {
      code: 'API_DISABLED',
      message: `La API de Google necesaria está deshabilitada en el proyecto de Google Cloud. Habilita Google Sheets API, Slides API y Drive API.`,
    };
  }
  if (status === 403) {
    return {
      code: 'PERMISSION_DENIED',
      message: `La cuenta ${serviceAccountEmail} no tiene permiso sobre ${what}. Compártelo con ese correo.`,
    };
  }
  if (status === 401) {
    return { code: 'CONFIG', message: 'Las credenciales de Google no son válidas. Revisa los secrets del proyecto.' };
  }
  return { code: 'GOOGLE_ERROR', message: `Error de Google al leer ${what}: ${e?.message ?? e}` };
}

/**
 * Carpeta raíz donde se crean las carpetas de salida del rotulado.
 * Si no hay una dedicada, se usa la misma raíz que las cotizaciones.
 */
export function getRotuladoRootFolderId(): string {
  const id = Deno.env.get('ROTULADO_ROOT_FOLDER_ID') || Deno.env.get('DRIVE_ROOT_FOLDER_ID');
  if (!id) {
    throw new AppError('CONFIG', 'Falta DRIVE_ROOT_FOLDER_ID en las variables de entorno del proyecto.');
  }
  return id;
}

/** Busca una carpeta por nombre exacto dentro de un padre. Devuelve null si no existe. */
export async function findFolderByName(
  // deno-lint-ignore no-explicit-any
  drive: any,
  parentId: string,
  name: string,
): Promise<{ id: string; webViewLink: string } | null> {
  const res = await withRetry('buscar la carpeta', () =>
    drive.files.list({
      q: `'${escapeQ(parentId)}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${escapeQ(name)}'`,
      fields: 'files(id,webViewLink)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }));
  const hit = res.data.files?.[0];
  return hit ? { id: hit.id, webViewLink: hit.webViewLink } : null;
}

/** Nombre de carpeta válido para Drive: sin barras ni espacios de sobra. */
export const sanitizeFolderName = (s: string) =>
  (s ?? '').replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

/** "smarterforms.typeform.com" → "typeform.com". Sirve para emparejar el
 *  enlace que ya trae la plantilla con el valor que dio el admin. */
export function registrableDomain(url: string): string | null {
  try {
    const parts = new URL(url).hostname.toLowerCase().split('.');
    return parts.length < 2 ? null : parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

/** De dónde cuelga un enlace dentro de la diapositiva. */
export type LinkKind = 'texto' | 'forma' | 'imagen';

export interface TemplateLink {
  url: string;
  kind: LinkKind;
}

/**
 * Todos los hipervínculos de la presentación, ya sin el redirector de Google.
 * Recorre texto, formas (botones), imágenes, celdas de tabla y grupos.
 */
// deno-lint-ignore no-explicit-any
export function collectLinks(presentation: any): TemplateLink[] {
  const links: TemplateLink[] = [];
  const push = (u: string | undefined, kind: LinkKind) => {
    if (!u) return;
    links.push({ url: unwrapGoogleRedirect(u) ?? u, kind });
  };

  // deno-lint-ignore no-explicit-any
  const scanText = (text: any) => {
    for (const el of text?.textElements ?? []) push(el?.textRun?.style?.link?.url, 'texto');
  };

  // deno-lint-ignore no-explicit-any
  const walk = (els: any[] = []) => {
    for (const el of els) {
      if (el.shape?.text) scanText(el.shape.text);
      push(el.shape?.shapeProperties?.link?.url, 'forma');
      push(el.image?.imageProperties?.link?.url, 'imagen');
      if (el.table?.tableRows) {
        for (const row of el.table.tableRows) for (const cell of row.tableCells ?? []) scanText(cell.text);
      }
      if (el.elementGroup?.children) walk(el.elementGroup.children);
    }
  };

  for (const page of presentation?.slides ?? []) walk(page.pageElements);
  return links;
}

/** `https://www.google.com/url?q=<destino>` → `<destino>`. */
export function unwrapGoogleRedirect(url: string): string | null {
  if (!/^https?:\/\/(www\.)?google\.com\/url\?/i.test(url ?? '')) return null;
  try {
    return new URL(url).searchParams.get('q');
  } catch {
    return null;
  }
}

/**
 * Deja los hipervínculos de la copia apuntando al destino real.
 *
 * Dos casos:
 *  - Texto que contiene una URL de los reemplazos y no está enlazado.
 *  - Cualquier enlace (en texto, forma o imagen) que Slides guardó como
 *    `google.com/url?q=...`; ese redirector es lo que hace que la invitación
 *    pase por Google antes de llegar a Typeform.
 */
// deno-lint-ignore no-explicit-any
export async function fixHyperlinks(
  // deno-lint-ignore no-explicit-any
  slides: any,
  presentationId: string,
  urls: string[],
) {
  const targets = urls.filter((u) => /^https?:\/\//i.test(u));

  // Un enlace de la plantilla se reapunta al valor que dio el admin cuando los
  // dos son del mismo dominio: el botón que va a typeform.com pasa a apuntar al
  // typeform de este evento, y el de instagram.com se queda como está.
  const byDomain = new Map<string, string>();
  for (const u of targets) {
    const d = registrableDomain(u);
    if (d && !byDomain.has(d)) byDomain.set(d, u);
  }

  /**
   * Destino final de un enlace que ya existía en la plantilla:
   *  - se le quita el redirector google.com/url
   *  - si hay una variable con una URL del mismo dominio, se usa esa
   * Devuelve null cuando no hay nada que cambiar.
   */
  const retarget = (current?: string): string | null => {
    if (!current) return null;
    const direct = unwrapGoogleRedirect(current) ?? current;
    const domain = registrableDomain(direct);
    const final = (domain ? byDomain.get(domain) : undefined) ?? direct;
    return final === current ? null : final;
  };

  const doc = await withRetry('leer la copia', () =>
    slides.presentations.get({ presentationId }));

  // deno-lint-ignore no-explicit-any
  const textRequests: any[] = [];
  // deno-lint-ignore no-explicit-any
  const objectRequests: any[] = [];

  // deno-lint-ignore no-explicit-any
  const scanText = (text: any, objectId: string, cellLocation?: any) => {
    for (const el of text?.textElements ?? []) {
      const run = el?.textRun;
      const content: string | undefined = run?.content;
      if (!content) continue;
      const base = el.startIndex ?? 0;

      // 1. Enlace ya existente: se desenvuelve y, si es de Typeform, se
      //    reapunta al del evento
      const direct = retarget(run?.style?.link?.url);
      if (direct) {
        textRequests.push({
          updateTextStyle: {
            objectId,
            ...(cellLocation ? { cellLocation } : {}),
            textRange: { type: 'FIXED_RANGE', startIndex: base, endIndex: base + content.length },
            style: { link: { url: direct } },
            fields: 'link',
          },
        });
        continue;
      }

      // 2. La URL quedó como texto plano tras el reemplazo
      for (const url of targets) {
        let at = content.indexOf(url);
        while (at !== -1) {
          textRequests.push({
            updateTextStyle: {
              objectId,
              ...(cellLocation ? { cellLocation } : {}),
              textRange: { type: 'FIXED_RANGE', startIndex: base + at, endIndex: base + at + url.length },
              style: { link: { url } },
              fields: 'link',
            },
          });
          at = content.indexOf(url, at + url.length);
        }
      }
    }
  };

  // deno-lint-ignore no-explicit-any
  const walk = (els: any[] = []) => {
    for (const el of els) {
      if (el.shape?.text) scanText(el.shape.text, el.objectId);

      // Botones: el enlace vive en la forma, no en el texto
      const shapeDirect = retarget(el.shape?.shapeProperties?.link?.url);
      if (shapeDirect) {
        objectRequests.push({
          updateShapeProperties: {
            objectId: el.objectId,
            shapeProperties: { link: { url: shapeDirect } },
            fields: 'link',
          },
        });
      }

      const imageDirect = retarget(el.image?.imageProperties?.link?.url);
      if (imageDirect) {
        objectRequests.push({
          updateImageProperties: {
            objectId: el.objectId,
            imageProperties: { link: { url: imageDirect } },
            fields: 'link',
          },
        });
      }

      if (el.table?.tableRows) {
        // deno-lint-ignore no-explicit-any
        el.table.tableRows.forEach((row: any, rowIndex: number) => {
          // deno-lint-ignore no-explicit-any
          (row.tableCells ?? []).forEach((cell: any, columnIndex: number) => {
            scanText(cell.text, el.objectId, { rowIndex, columnIndex });
          });
        });
      }

      if (el.elementGroup?.children) walk(el.elementGroup.children);
    }
  };

  for (const page of doc.data.slides ?? []) walk(page.pageElements);

  if (textRequests.length) {
    await withRetry('fijar los enlaces', () =>
      slides.presentations.batchUpdate({ presentationId, requestBody: { requests: textRequests } }));
  }
  // Aparte y tolerante a fallo: si la API rechaza alguno, el PDF igual sale
  if (objectRequests.length) {
    await slides.presentations
      .batchUpdate({ presentationId, requestBody: { requests: objectRequests } })
      .catch(() => {});
  }
}

export const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';
export const MIME_SLIDES = 'application/vnd.google-apps.presentation';
export const MIME_FOLDER = 'application/vnd.google-apps.folder';

/** Nombre de la subcarpeta que se crea dentro de la carpeta del evento. */
export const OUTPUT_FOLDER_NAME = 'Invitaciones rotuladas';

/**
 * Busca el único archivo de un tipo dentro de una carpeta.
 * El nombre da igual: lo que importa es que haya exactamente uno.
 */
export async function findSingleFileByMime(
  // deno-lint-ignore no-explicit-any
  drive: any,
  folderId: string,
  mimeType: string,
  label: string,
): Promise<{ id: string; name: string }> {
  const res = await withRetry(`buscar ${label}`, () =>
    drive.files.list({
      q: `'${escapeQ(folderId)}' in parents and trashed=false and mimeType='${mimeType}'`,
      fields: 'files(id,name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }));

  const files = res.data.files ?? [];
  if (files.length === 0) {
    throw new AppError('MISSING_SOURCE', `No encontré ${label} en la carpeta del evento. Súbelo antes de generar.`);
  }
  if (files.length > 1) {
    const names = files.map((f: { name: string }) => `"${f.name}"`).join(', ');
    throw new AppError(
      'AMBIGUOUS_SOURCE',
      `Hay ${files.length} archivos que podrían ser ${label} (${names}). Deja solo uno en la carpeta del evento.`,
    );
  }
  return { id: files[0].id, name: files[0].name };
}
