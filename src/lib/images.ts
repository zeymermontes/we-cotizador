// Subida eficiente de imágenes al bucket `event-assets`.
//
// Todo se redimensiona y convierte a WebP en el navegador antes de subir:
// un logo de 4 MB se vuelve ~30 KB y un fondo de 12 MB ~150 KB. Los SVG
// se suben tal cual (ya son chicos y escalan sin pérdida).

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

/** Tamaño máximo aceptado ANTES de comprimir. */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
/** Tamaño máximo que dejamos subir DESPUÉS de comprimir (coincide con el bucket). */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

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

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // imageOrientation respeta el EXIF de fotos tomadas con el celular
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* cae al <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen inválida')); };
    img.src = url;
  });
}

export async function compressImage(file: File, kind: ImageKind): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('La imagen pesa más de 15 MB');

  if (file.type === 'image/svg+xml') {
    return { blob: file, contentType: 'image/svg+xml', extension: 'svg', width: 0, height: 0, originalBytes: file.size };
  }

  const { maxSide, quality } = LIMITS[kind];
  const source = await decode(file);
  const srcW = source.width;
  const srcH = source.height;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source) source.close();

  let blob = await canvasToBlob(canvas, 'image/webp', quality);
  let contentType = 'image/webp';
  let extension = 'webp';

  // Safari viejo no codifica WebP y devuelve PNG disfrazado
  if (blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/png', 1);
    contentType = 'image/png';
    extension = 'png';
  }

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error('La imagen sigue siendo demasiado grande después de comprimirla');
  }

  return { blob, contentType, extension, width, height, originalBytes: file.size };
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
): Promise<UploadedImage> {
  const compressed = await compressImage(file, kind);
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
