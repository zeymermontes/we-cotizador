// ─────────────────────────────────────────────────────────────
// invitations-create-template — arma una plantilla de Google Slides con
// el diseño del evento (fondo, logo, colores, fuentes, textos) y la deja
// en la carpeta del evento en Drive. A partir de ahí las invitaciones se
// generan en la nube con invitations-run-batch, igual que el rotulado.
// Solo super.
//
// Body: { event_id, replace?: boolean, logo_url?, background_url? }
//   replace → si ya había una plantilla creada aquí, se manda a la papelera
//   logo_url / background_url → copias en PNG/JPEG de las imágenes del
//   diseño (Slides no acepta WebP); las prepara el navegador
// Responde { ok, template: { id, url, name }, folder: { id, url }, config }
//
// La diapositiva mide 540×810 pt (proporción 2:3, la misma que la imagen
// de 1080×1620 del diseño en navegador). Marcadores: {{nombre}},
// {{pases_texto}} y una forma con texto alternativo {{qr}}.
// ─────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Readable } from "node:stream";
import { corsHeaders, json, fail } from "../_shared/cors.ts";
import { SEED_PPTX_BASE64 } from "./seed.ts";
import { describeGoogleError, escapeQ, getGoogleClients, withRetry } from "../_shared/google.ts";
import { ensureEventFolder, imageDims, trashFile } from "../_shared/drive-folders.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const W = 540;
const H = 810;

const DEFAULT_BRANDING = {
  logo_url: null as string | null, background_url: null as string | null,
  primary: '#BBEBE8', background: '#f0eeeb', surface: '#ffffff', text: '#1a1a1a',
  font_display: 'Playfair Display', font_body: 'Inter',
};
const DEFAULT_GENERIC = { title: '', subtitle: '', message: 'Presenta este código en la entrada', show_name: true };

type Rgb = { red: number; green: number; blue: number };
function rgb(hex: string): Rgb {
  const h = (hex || '#000000').replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return { red: parseInt(v.slice(0, 2), 16) / 255, green: parseInt(v.slice(2, 4), 16) / 255, blue: parseInt(v.slice(4, 6), 16) / 255 };
}
/** Slides no acepta texto con transparencia: se mezcla con el fondo. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { red: a.red * t + b.red * (1 - t), green: a.green * t + b.green * (1 - t), blue: a.blue * t + b.blue * (1 - t) };
}
const pt = (magnitude: number) => ({ magnitude, unit: 'PT' });
const box = (page: string, x: number, y: number, w: number, h: number) => ({
  pageObjectId: page, size: { width: pt(w), height: pt(h) }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'PT' },
});
/** Líneas que ocupará un texto centrado en una caja (estimación por ancho medio de carácter). */
function lines(text: string, fontPt: number, boxW: number): number {
  return (text || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((l.length * fontPt * 0.52) / boxW)), 0);
}

function eventSubtitle(event: { event_date: string | null; timezone: string | null; venue: string | null }, lang: string): string {
  const parts: string[] = [];
  if (event.event_date) {
    const d = new Date(event.event_date);
    try {
      parts.push(d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: event.timezone ?? undefined }));
    } catch { parts.push(d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US')); }
  }
  if (event.venue) parts.push(event.venue);
  return parts.join(' · ');
}

async function fetchDims(url: string | null): Promise<{ width: number; height: number } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return imageDims(new Uint8Array(await res.arrayBuffer()));
  } catch { return null; }
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
    if (profile?.role !== 'super') return fail('forbidden', 'Solo el equipo puede crear plantillas');

    const body = await req.json().catch(() => ({}));
    const eventId = String(body.event_id ?? '');
    if (!eventId) return fail('bad_request', 'Falta event_id');
    const { data: event } = await db.from('events')
      .select('id, name, slug, event_date, timezone, venue, default_language, branding, screens, invitation_config, drive_folder_id, drive_folder_url')
      .eq('id', eventId).maybeSingle();
    if (!event) return fail('not_found', 'El evento no existe');

    const g = getGoogleClients();
    serviceAccountEmail = g.serviceAccountEmail;
    const { drive, slides } = g;

    const b = { ...DEFAULT_BRANDING, ...(event.branding ?? {}) };
    if (typeof body.logo_url === 'string') b.logo_url = body.logo_url || null;
    if (typeof body.background_url === 'string') b.background_url = body.background_url || null;
    const cfg = (event.invitation_config ?? {}) as Record<string, unknown>;
    const s = { ...DEFAULT_GENERIC, ...((cfg.generic as Record<string, unknown>) ?? {}) };
    const lang = event.default_language === 'en' ? 'en' : 'es';
    const showPowered = (event.screens?.footer?.elements?.powered?.show) !== false;

    const folder = await ensureEventFolder(db, drive, event, serviceAccountEmail);

    // ── Presentación 540×810 pt creada dentro de la carpeta del evento ──
    // La cuenta de servicio no puede crear archivos en su propio Drive
    // (presentations.create falla), así que se sube un PPTX mínimo con ese
    // tamaño de página y Drive lo convierte a Slides en la carpeta.
    const title = `Invitación · ${event.name}`;
    // Restos de intentos anteriores con el mismo nombre (fallos a medias) → papelera
    const dupes = await drive.files.list({
      q: `'${escapeQ(folder.id)}' in parents and trashed=false and name='${escapeQ(title)}' and mimeType='application/vnd.google-apps.presentation'`,
      fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    for (const f of dupes.data.files ?? []) await trashFile(drive, f.id as string);
    const seed = Uint8Array.from(atob(SEED_PPTX_BASE64), c => c.charCodeAt(0));
    const created = await withRetry('crear la presentación', () =>
      drive.files.create({
        requestBody: { name: title, mimeType: 'application/vnd.google-apps.presentation', parents: [folder.id] },
        media: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', body: Readable.from([seed]) },
        fields: 'id', supportsAllDrives: true,
      }));
    const presentationId = created.data.id as string;
    const doc = await withRetry('leer la presentación', () => slides.presentations.get({ presentationId, fields: 'slides.objectId' }));
    const defaultSlideId = doc.data.slides?.[0]?.objectId as string | undefined;

    // ── Diseño ───────────────────────────────────────────────
    const [logoDims, bgDims] = await Promise.all([fetchDims(b.logo_url), fetchDims(b.background_url)]);
    const textColor = rgb(b.text);
    const bgColor = rgb(b.background);
    // Con foto de fondo el velo oscuro cambia el color sobre el que se mezcla el texto
    const under = b.background_url ? mix(bgColor, { red: 0, green: 0, blue: 0 }, 0.6) : bgColor;
    const soft = (alpha: number) => mix(textColor, under, alpha);

    const SLIDE = 'slide_main';
    // deno-lint-ignore no-explicit-any
    const reqs: any[] = [
      { createSlide: { objectId: SLIDE, insertionIndex: 0, slideLayoutReference: { predefinedLayout: 'BLANK' } } },
      { updatePageProperties: { objectId: SLIDE, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: bgColor } } } }, fields: 'pageBackgroundFill.solidFill.color' } },
    ];
    if (defaultSlideId) reqs.push({ deleteObject: { objectId: defaultSlideId } });

    let n = 0;
    const id = (p: string) => `${p}_${++n}`;
    const textBox = (text: string, x: number, y: number, w: number, h: number, style: { font: string; size: number; weight?: number; bold?: boolean; color: Rgb; valign?: 'TOP' | 'MIDDLE' }) => {
      const objectId = id('txt');
      reqs.push({ createShape: { objectId, shapeType: 'TEXT_BOX', elementProperties: box(SLIDE, x, y, w, h) } });
      reqs.push({ insertText: { objectId, text, insertionIndex: 0 } });
      reqs.push({ updateTextStyle: {
        objectId, textRange: { type: 'ALL' },
        style: { fontSize: pt(style.size), weightedFontFamily: { fontFamily: style.font, weight: style.weight ?? 400 }, bold: !!style.bold, foregroundColor: { opaqueColor: { rgbColor: style.color } } },
        fields: 'fontSize,weightedFontFamily,bold,foregroundColor',
      } });
      reqs.push({ updateParagraphStyle: { objectId, textRange: { type: 'ALL' }, style: { alignment: 'CENTER', lineSpacing: 115 }, fields: 'alignment,lineSpacing' } });
      reqs.push({ updateShapeProperties: { objectId, shapeProperties: { contentAlignment: style.valign ?? 'TOP', autofit: { autofitType: 'NONE' } }, fields: 'contentAlignment,autofit.autofitType' } });
      return objectId;
    };

    // Fondo: la foto cubre toda la página (lo que sobra queda fuera del lienzo) + velo oscuro
    if (b.background_url) {
      const bw = bgDims?.width ?? 1080, bh = bgDims?.height ?? 1620;
      const scale = Math.max(W / bw, H / bh);
      const dw = bw * scale, dh = bh * scale;
      reqs.push({ createImage: { objectId: 'bg_photo', url: b.background_url, elementProperties: box(SLIDE, (W - dw) / 2, (H - dh) / 2, dw, dh) } });
      reqs.push({ createShape: { objectId: 'bg_veil', shapeType: 'RECTANGLE', elementProperties: box(SLIDE, 0, 0, W, H) } });
      reqs.push({ updateShapeProperties: { objectId: 'bg_veil', shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: { red: 0, green: 0, blue: 0 } }, alpha: 0.36 } }, outline: { propertyState: 'NOT_RENDERED' } }, fields: 'shapeBackgroundFill.solidFill,outline.propertyState' } });
    }

    const cx = W / 2;
    let y = 55;
    if (b.logo_url) {
      const lw = logoDims?.width ?? 400, lh = logoDims?.height ?? 180;
      const scale = Math.min(210 / lw, 95 / lh, 1.5);
      const dw = lw * scale, dh = lh * scale;
      reqs.push({ createImage: { objectId: 'logo_img', url: b.logo_url, elementProperties: box(SLIDE, cx - dw / 2, y, dw, dh) } });
      y += dh + 35;
    } else y += 20;

    const titleText = (s.title as string).trim() || event.name;
    const titleLines = lines(titleText, 32, 460);
    textBox(titleText, 40, y, 460, titleLines * 38 + 10, { font: b.font_display, size: 32, weight: 500, color: textColor });
    y += titleLines * 38 + 12;

    const subtitle = (s.subtitle as string).trim() || eventSubtitle(event, lang);
    if (subtitle) {
      const sl = lines(subtitle, 17, 450);
      textBox(subtitle, 45, y, 450, sl * 23 + 8, { font: b.font_body, size: 17, color: soft(0.85) });
      y += sl * 23 + 10;
    }

    if (s.show_name) {
      textBox(lang === 'es' ? 'Invitación para' : 'Invitation for', 40, y + 8, 460, 22, { font: b.font_body, size: 14, color: soft(0.7) });
      y += 32;
      textBox('{{nombre}}', 40, y, 460, 70, { font: b.font_display, size: 27, bold: true, color: textColor });
      y += 66;
    }

    // Tarjeta blanca con el QR
    const card = 300;
    const cardY = Math.max(y + 15, Math.min(H - card - 150, y + 20));
    reqs.push({ createShape: { objectId: 'qr_card', shapeType: 'ROUND_RECTANGLE', elementProperties: box(SLIDE, cx - card / 2, cardY, card, card) } });
    reqs.push({ updateShapeProperties: { objectId: 'qr_card', shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } }, outline: { propertyState: 'NOT_RENDERED' } }, fields: 'shapeBackgroundFill.solidFill,outline.propertyState' } });
    reqs.push({ createShape: { objectId: 'qr_slot', shapeType: 'RECTANGLE', elementProperties: box(SLIDE, cx - 130, cardY + 20, 260, 260) } });
    reqs.push({ updateShapeProperties: { objectId: 'qr_slot', shapeProperties: { shapeBackgroundFill: { propertyState: 'NOT_RENDERED' }, outline: { propertyState: 'NOT_RENDERED' } }, fields: 'shapeBackgroundFill.propertyState,outline.propertyState' } });
    reqs.push({ updatePageElementAltText: { objectId: 'qr_slot', title: '{{qr}}', description: 'Aquí se coloca el QR de cada invitado' } });

    y = cardY + card + 30;
    const message = (s.message as string).trim();
    if (message) {
      const ml = lines(message, 16, 440);
      textBox(message, 50, y, 440, ml * 21 + 8, { font: b.font_body, size: 16, color: soft(0.92) });
      y += ml * 21 + 10;
    }
    textBox('{{pases_texto}}', 50, y, 440, 24, { font: b.font_body, size: 15, weight: 500, color: textColor });

    if (showPowered) textBox('Powered by We.Page', 40, H - 36, 460, 20, { font: b.font_body, size: 11, color: soft(0.5) });

    try {
      await withRetry('dibujar la plantilla', () => slides.presentations.batchUpdate({ presentationId, requestBody: { requests: reqs } }));
    } catch (e) {
      // Sin dibujo no sirve: no dejar un archivo vacío en la carpeta
      await trashFile(drive, presentationId);
      throw e;
    }

    // ── Plantilla anterior creada aquí → papelera ─────────────
    if (body.replace && cfg.auto_template && cfg.template_id && cfg.template_id !== presentationId) {
      await trashFile(drive, String(cfg.template_id));
    }

    const templateUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
    const config = {
      ...cfg,
      generic: s,
      event_folder_id: folder.id,
      event_folder_url: folder.url,
      template_id: presentationId,
      template_url: templateUrl,
      template_name: title,
      output_folder_name: 'Invitaciones',
      placeholder_map: {
        '{{nombre}}': { source: 'field', field: 'name' },
        '{{pases_texto}}': { source: 'field', field: 'party_text' },
      },
      file_name_template: '{{nombre}}',
      placeholders: ['{{nombre}}', '{{pases_texto}}'],
      qr_shapes: 1,
      output_format: 'png',
      auto_template: true,
      template_created_at: new Date().toISOString(),
    };
    const { error } = await db.from('events').update({ invitation_config: config }).eq('id', eventId);
    if (error) throw new Error(error.message);

    return json({ ok: true, template: { id: presentationId, url: templateUrl, name: title }, folder, config });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'CONFIG') return fail('CONFIG', (e as Error).message, { service_account_email: serviceAccountEmail });
    const d = describeGoogleError(e, 'la carpeta del evento en Drive', serviceAccountEmail);
    return fail(d.code, d.message, { service_account_email: serviceAccountEmail });
  }
});
