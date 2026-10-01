// Subida eficiente de imágenes al bucket `event-assets`.
//
// Todo se redimensiona y convierte a WebP en el navegador antes de subir:
// un logo de 4 MB se vuelve ~30 KB y un fondo de 40 MB ~200 KB. Acepta
// JPG, PNG, WebP, GIF, BMP, TIFF, AVIF y HEIC/HEIF (fotos de iPhone; se
// decodifican con un conversor que solo se descarga cuando hace falta).
// Si el resultado sigue pesando más de lo permitido, baja calidad y tamaño
// por pasos hasta que quepa. Los SVG se suben tal cual.

import { supabase } from './supabase';

export type ImageKind = 'logo' | 'background' | 'question' | 'qr';

interface Limits {
  /** Lado mayor máximo en px */
  maxSide: number;
  /** Calidad WebP 0..1 */
  quality: number;
}

const LIMITS: Record<ImageKind, Limits> = {
  logo: { maxSide: 800, quality: 0.9 },
  background: { maxSide: 2000, quality: 0.8 },
  question: { maxSide: 1400, quality: 0.82 },
  qr: { maxSide: 800, quality: 1 },
};

/** Tamaño máximo aceptado ANTES de comprimir (solo evita colgar el navegador). */
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
/** Tamaño máximo que dejamos subir DESPUÉS de comprimir (coincide con el bucket). */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export type ImageStage = 'decode' | 'compress' | 'upload';

export interface CompressedImage {
  blob: Blob;
  contentType: string;
  extension: string;
  width: number;
  height: number;
  originalBytes: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), type, quality);
  });
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif|svg)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;

function isHeic(file: File): boolean {
  return file.type === 'image/heic' || file.type === 'image/heif' || HEIC_EXT.test(file.name);
}

function looksLikeImage(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

/** HEIC/HEIF → JPEG en el navegador. El conversor pesa ~1 MB y se carga solo aquí. */
async function heicToJpeg(file: File): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
  return Array.isArray(out) ? out[0] : out;
}

function decodeViaImg(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen. Prueba con JPG, PNG o WebP.')); };
    img.src = url;
  });
}

async function decodeBlob(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // imageOrientation respeta el EXIF de fotos tomadas con el celular
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      /* cae al <img> */
    }
  }
  return decodeViaImg(blob);
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (isHeic(file)) {
    // Safari lo decodifica nativo; Chrome y Firefox necesitan el conversor.
    try {
      return await decodeBlob(file);
    } catch {
      return decodeBlob(await heicToJpeg(file));
    }
  }
  return decodeBlob(file);
}

/** Pasos de calidad y de tamaño que se intentan hasta que el archivo quepa. */
const QUALITY_STEPS = [1, 0.85, 0.7, 0.55] as const;
const SIDE_STEPS = [1, 0.8, 0.65, 0.5] as const;

export async function compressImage(file: File, kind: ImageKind, onStage?: (s: ImageStage) => void): Promise<CompressedImage> {
  if (!looksLikeImage(file)) throw new Error('El archivo no es una imagen');
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`La imagen pesa ${formatBytes(file.size)}; el máximo es ${formatBytes(MAX_SOURCE_BYTES)}`);

  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    return { blob: file, contentType: 'image/svg+xml', extension: 'svg', width: 0, height: 0, originalBytes: file.size };
  }

  const { maxSide, quality } = LIMITS[kind];
  onStage?.('decode');
  const source = await decode(file);
  const srcW = source.width;
  const srcH = source.height;
  if (!srcW || !srcH) throw new Error('La imagen está vacía o dañada');

  onStage?.('compress');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');
  ctx.imageSmoothingQuality = 'high';

  // Safari viejo no codifica WebP y devuelve PNG disfrazado; se detecta en el primer intento.
  let type = 'image/webp';
  let best: { blob: Blob; width: number; height: number } | null = null;

  try {
    for (const sideFactor of SIDE_STEPS) {
      const scale = Math.min(1, (maxSide * sideFactor) / Math.max(srcW, srcH));
      const width = Math.max(1, Math.round(srcW * scale));
      const height = Math.max(1, Math.round(srcH * scale));
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);

      for (const qFactor of QUALITY_STEPS) {
        const q = type === 'image/png' ? 1 : Math.max(0.3, quality * qFactor);
        const blob = await canvasToBlob(canvas, type, q);
        if (blob.type !== type) type = blob.type === 'image/png' ? 'image/png' : type;
        if (!best || blob.size < best.blob.size) best = { blob, width, height };
        if (blob.size <= MAX_UPLOAD_BYTES) {
          return finish(best, file.size);
        }
        if (type === 'image/png') break; // PNG no tiene calidad: solo ayuda reducir tamaño
      }
    }
  } finally {
    if ('close' in source) source.close();
  }

  if (!best || best.blob.size > MAX_UPLOAD_BYTES) {
    throw new Error('La imagen sigue siendo demasiado grande después de comprimirla. Prueba con una versión más pequeña.');
  }
  return finish(best, file.size);
}

function finish(r: { blob: Blob; width: number; height: number }, originalBytes: number): CompressedImage {
  const png = r.blob.type === 'image/png';
  return { blob: r.blob, contentType: png ? 'image/png' : 'image/webp', extension: png ? 'png' : 'webp', width: r.width, height: r.height, originalBytes };
}

export interface UploadedImage extends CompressedImage {
  path: string;
  url: string;
}

/**
 * Comprime y sube. El nombre lleva un sello de tiempo para que el CDN
 * nunca sirva una versión vieja (cache inmutable de 1 año).
 */
export async function uploadEventImage(
  eventId: string,
  kind: ImageKind,
  file: File,
  name?: string,
  onStage?: (s: ImageStage) => void,
): Promise<UploadedImage> {
  const compressed = await compressImage(file, kind, onStage);
  onStage?.('upload');
  const base = (name || kind).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || kind;
  const path = `${eventId}/${kind}/${base}-${Date.now()}.${compressed.extension}`;

  const { error } = await supabase.storage
    .from('event-assets')
    .upload(path, compressed.blob, {
      contentType: compressed.contentType,
      cacheControl: '31536000',
      upsert: false,
    });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from('event-assets').getPublicUrl(path);
  return { ...compressed, path, url: data.publicUrl };
}

/** Borra la versión anterior para no acumular basura en el bucket. */
export async function removeEventImage(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const marker = '/event-assets/';
  const i = url.indexOf(marker);
  if (i < 0) return;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  await supabase.storage.from('event-assets').remove([path]);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
