// Invitación genérica dibujada en el navegador a partir del branding del
// evento: fondo, logo, título, fecha y lugar, nombre del invitado y su QR.
// Sirve cuando no hay plantilla de Google Slides. Sale como PNG (o JPEG si
// el PNG pasa de 2.8 MB) de 1080×1620, lista para WhatsApp.

import type { EventRow } from './events-types';
import { DEFAULT_BRANDING, elementShown } from './events-types';
import { fontsHref } from './branding';
import type { Lang } from './form-types';

export interface GenericInvitationSettings {
  /** Vacío = nombre del evento */
  title?: string;
  /** Vacío = fecha · lugar */
  subtitle?: string;
  /** Texto bajo el QR */
  message?: string;
  show_name?: boolean;
}

export const DEFAULT_GENERIC: Required<GenericInvitationSettings> = {
  title: '',
  subtitle: '',
  message: 'Presenta este código en la entrada',
  show_name: true,
};

export const INVITATION_W = 1080;
export const INVITATION_H = 1620;

export interface InvitationGuest {
  name: string | null;
  party_size: number;
  qr_url: string | null;
}

/** Fecha larga y lugar, como en la bienvenida del formulario. */
export function defaultSubtitle(event: EventRow, lang: Lang): string {
  const parts: string[] = [];
  if (event.event_date) {
    const d = new Date(event.event_date);
    try {
      parts.push(d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: event.timezone }));
    } catch {
      parts.push(d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US'));
    }
  }
  if (event.venue) parts.push(event.venue);
  return parts.join(' · ');
}

async function ensureFonts(families: string[]): Promise<void> {
  const href = fontsHref(families);
  let link = document.querySelector<HTMLLinkElement>(`link[href="${href}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
  // fonts.load solo espera descargas de @font-face ya conocidos: primero debe
  // llegar la hoja de Google Fonts.
  if (!link.sheet) {
    await Promise.race([
      new Promise<void>(r => { link!.addEventListener('load', () => r(), { once: true }); link!.addEventListener('error', () => r(), { once: true }); }),
      new Promise<void>(r => setTimeout(r, 4000)),
    ]);
  }
  const loads = families.flatMap(f => [
    document.fonts.load(`500 64px "${f}"`),
    document.fonts.load(`700 54px "${f}"`),
    document.fonts.load(`400 34px "${f}"`),
  ]);
  // Si la fuente no llega en unos segundos, se dibuja con la de respaldo.
  await Promise.race([Promise.allSettled(loads), new Promise(r => setTimeout(r, 4000))]);
}

function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of (text ?? '').split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const probe = line ? `${line} ${w}` : w;
      if (ctx.measureText(probe).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = probe;
    }
    lines.push(line);
  }
  return lines;
}

function drawLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number): number {
  for (const l of lines) {
    ctx.fillText(l, x, y);
    y += lineHeight;
  }
  return y;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function contain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, top: number, maxW: number, maxH: number): number {
  const scale = Math.min(maxW / img.width, maxH / img.height, 1.5);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, cx - dw / 2, top, dw, dh);
  return dh;
}

/** Dibuja la invitación y devuelve el canvas listo para exportar. */
export async function drawGenericInvitation(event: EventRow, guest: InvitationGuest, settings: GenericInvitationSettings, lang: Lang): Promise<HTMLCanvasElement> {
  const b = { ...DEFAULT_BRANDING, ...(event.branding ?? {}) };
  const s = { ...DEFAULT_GENERIC, ...settings };
  await ensureFonts([b.font_display, b.font_body]);
  const [bg, logo, qr] = await Promise.all([loadImage(b.background_url), loadImage(b.logo_url), loadImage(guest.qr_url)]);

  const W = INVITATION_W;
  const H = INVITATION_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Fondo + velo para que el texto se lea sobre cualquier foto
  ctx.fillStyle = b.background;
  ctx.fillRect(0, 0, W, H);
  if (bg) {
    cover(ctx, bg, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const cx = W / 2;
  let y = 110;
  if (logo) y += contain(ctx, logo, cx, y, 420, 190) + 70;
  else y += 40;

  ctx.fillStyle = b.text;
  ctx.font = `500 64px "${b.font_display}", serif`;
  const title = s.title.trim() || event.name;
  y = drawLines(ctx, wrap(ctx, title, 920), cx, y + 60, 76);

  const subtitle = s.subtitle.trim() || defaultSubtitle(event, lang);
  if (subtitle) {
    ctx.font = `400 34px "${b.font_body}", sans-serif`;
    ctx.globalAlpha = 0.85;
    y = drawLines(ctx, wrap(ctx, subtitle, 900), cx, y + 10, 46);
    ctx.globalAlpha = 1;
  }

  if (s.show_name && guest.name) {
    ctx.font = `400 28px "${b.font_body}", sans-serif`;
    ctx.globalAlpha = 0.7;
    ctx.fillText(lang === 'es' ? 'Invitación para' : 'Invitation for', cx, y + 46);
    ctx.globalAlpha = 1;
    ctx.font = `700 54px "${b.font_display}", serif`;
    y = drawLines(ctx, wrap(ctx, guest.name, 920), cx, y + 112, 64);
  }

  // Tarjeta blanca con el QR, centrada en lo que queda
  const card = 600;
  const cardY = Math.max(y + 30, Math.min(H - card - 300, y + 40));
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cx - card / 2, cardY, card, card, 36);
  ctx.fill();
  ctx.restore();
  if (qr) {
    ctx.drawImage(qr, cx - 260, cardY + 40, 520, 520);
  } else {
    ctx.fillStyle = '#9a9a9a';
    ctx.font = `500 40px "${b.font_body}", sans-serif`;
    ctx.fillText('QR', cx, cardY + card / 2 + 14);
  }

  y = cardY + card + 70;
  ctx.fillStyle = b.text;
  if (s.message.trim()) {
    ctx.font = `400 32px "${b.font_body}", sans-serif`;
    ctx.globalAlpha = 0.92;
    y = drawLines(ctx, wrap(ctx, s.message, 880), cx, y, 42);
    ctx.globalAlpha = 1;
  }
  if (guest.party_size > 1) {
    ctx.font = `500 30px "${b.font_body}", sans-serif`;
    ctx.fillText(lang === 'es' ? `Válida para ${guest.party_size} personas` : `Valid for ${guest.party_size} people`, cx, y + 14);
  }

  if (elementShown(event.screens?.footer, 'powered')) {
    ctx.font = `400 24px "${b.font_body}", sans-serif`;
    ctx.globalAlpha = 0.5;
    ctx.fillText('Powered by We.Page', cx, H - 56);
    ctx.globalAlpha = 1;
  }

  return canvas;
}

export interface InvitationImage { blob: Blob; extension: 'png' | 'jpg'; contentType: string }

/** PNG para que el QR quede nítido; JPEG solo si el PNG se pasa de peso. */
export async function exportInvitation(canvas: HTMLCanvasElement): Promise<InvitationImage> {
  const toBlob = (type: string, q?: number) => new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('No se pudo exportar'))), type, q));
  const png = await toBlob('image/png');
  if (png.size <= 2.8 * 1024 * 1024) return { blob: png, extension: 'png', contentType: 'image/png' };
  const jpg = await toBlob('image/jpeg', 0.92);
  return { blob: jpg, extension: 'jpg', contentType: 'image/jpeg' };
}

export async function renderGenericInvitation(event: EventRow, guest: InvitationGuest, settings: GenericInvitationSettings, lang: Lang): Promise<InvitationImage> {
  return exportInvitation(await drawGenericInvitation(event, guest, settings, lang));
}
