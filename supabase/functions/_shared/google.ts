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
  (s || 'invitado')
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
