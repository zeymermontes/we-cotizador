// QR, invitaciones desde Slides y Excel para el bot de WhatsApp (solo super).
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import type { FormSchema, Lang } from './form-types';
import { text } from './form-types';
import type { Registration } from './registrations';
import { answerText } from './registrations';
import type { EventRow } from './events-types';
import { removeEventImage } from './images';
import { renderGenericInvitation, type GenericInvitationSettings } from './invitation-canvas';

export type MappingSource = 'field' | 'question' | 'literal' | 'qr' | 'empty';

export interface PlaceholderMapping {
  source: MappingSource;
  field?: string;
  questionId?: string;
  value?: string;
}

export const FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'name', label: 'Nombre completo' },
  { key: 'first_name', label: 'Primer nombre' },
  { key: 'party_size', label: 'Número de personas' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'email', label: 'Correo' },
  { key: 'company', label: 'Empresa' },
  { key: 'event', label: 'Nombre del evento' },
  { key: 'date', label: 'Fecha del evento' },
  { key: 'time', label: 'Hora del evento' },
  { key: 'venue', label: 'Lugar' },
];

export interface InvitationConfig {
  event_folder_id: string;
  event_folder_url: string;
  template_id: string;
  template_url: string;
  template_name: string;
  output_folder_name: string;
  placeholder_map: Record<string, PlaceholderMapping>;
  file_name_template: string;
  placeholders: string[];
  qr_shapes: number;
  /** Diseño genérico (sin Slides); convive con la plantilla. */
  generic?: GenericInvitationSettings;
}

/** La parte de Slides solo cuenta como configurada si hay plantilla. */
export function slidesConfig(cfg: unknown): InvitationConfig | null {
  const c = cfg as InvitationConfig | null;
  return c && c.template_id ? c : null;
}

export function genericSettings(cfg: unknown): GenericInvitationSettings {
  return ((cfg as InvitationConfig | null)?.generic) ?? {};
}

export interface InspectResult {
  ok: true;
  service_account_email: string;
  folder: { id: string; name: string; url: string };
  template: { id: string; name: string; url: string; placeholders: string[]; qr_shapes: number; slide_count: number };
  suggested_map: Record<string, PlaceholderMapping>;
  warnings: string[];
}

export interface FunctionError { ok: false; code: string; message: string; service_account_email?: string; retryable?: boolean }

export type InvitationJobStatus = 'ready' | 'running' | 'paused' | 'completed' | 'failed';

export interface InvitationJob {
  id: string;
  event_id: string;
  name: string;
  config: InvitationConfig;
  registration_ids: string[];
  force: boolean;
  output_folder_id: string | null;
  output_folder_url: string | null;
  status: InvitationJobStatus;
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  last_error: string | null;
  row_errors: { registration_id: string; name: string; message: string; retryable: boolean }[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export const JOB_STATUS_LABEL: Record<InvitationJobStatus, string> = {
  ready: 'Lista', running: 'Generando', paused: 'Pausada', completed: 'Completada', failed: 'Falló',
};
export const JOB_STATUS_BADGE: Record<InvitationJobStatus, string> = {
  ready: 'badge-pendiente', running: 'badge-enviada', paused: 'badge-cotizado', completed: 'badge-aceptada', failed: 'badge-rechazada',
};

// ─── QR ──────────────────────────────────────────────────────

export interface QrProgress { done: number; failed: number; remaining: number }

/** Llama a generate-qr en lotes hasta terminar. */
export async function generateQrs(eventId: string, opts: { ids?: string[]; all?: boolean; force?: boolean }, onProgress?: (p: QrProgress) => void): Promise<QrProgress> {
  const total: QrProgress = { done: 0, failed: 0, remaining: 0 };
  for (let i = 0; i < 100; i++) {
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; done: number; failed: number; remaining: number; message?: string }>('generate-qr', {
      body: { event_id: eventId, registration_ids: opts.ids, all: opts.all, force: opts.force },
    });
    if (error || !data?.ok) throw new Error(data?.message || error?.message || 'No se pudieron generar los QR');
    total.done += data.done; total.failed += data.failed; total.remaining = data.remaining;
    onProgress?.({ ...total });
    if (data.remaining === 0 || (data.done === 0 && data.failed > 0)) break;
  }
  return total;
}

// ─── Invitación genérica (imagen desde el branding) ──────────

/** skipped: registros sin QR (cancelados): no se les dibuja invitación. */
export interface GenericProgress { done: number; failed: number; skipped: number; total: number; current?: string; drive_error?: string }

/**
 * Genera la invitación genérica de cada registro: asegura su QR, la dibuja
 * en el navegador, la sube al bucket y guarda la URL en invitation_url.
 */
export async function generateGenericInvitations(
  event: EventRow,
  regs: Registration[],
  settings: GenericInvitationSettings,
  lang: Lang,
  onProgress?: (p: GenericProgress) => void,
): Promise<GenericProgress> {
  const p: GenericProgress = { done: 0, failed: 0, skipped: 0, total: regs.length };
  const missingQr = regs.filter(r => !r.qr_url).map(r => r.id);
  if (missingQr.length) {
    onProgress?.({ ...p, current: `QR de ${missingQr.length} registros…` });
    await generateQrs(event.id, { ids: missingQr });
  }
  // Releer: los QR recién generados y la invitación anterior a reemplazar
  const fresh = new Map<string, Pick<Registration, 'id' | 'name' | 'party_size' | 'qr_url' | 'invitation_url' | 'invitation_drive_id'>>();
  for (let i = 0; i < regs.length; i += 200) {
    const { data } = await supabase.from('registrations').select('id, name, party_size, qr_url, invitation_url, invitation_drive_id').in('id', regs.slice(i, i + 200).map(r => r.id));
    for (const r of (data ?? []) as Registration[]) fresh.set(r.id, r);
  }
  for (const reg of regs) {
    const r = fresh.get(reg.id) ?? reg;
    onProgress?.({ ...p, current: r.name ?? r.id });
    // Sin QR (generate-qr omite los cancelados): una invitación sin código engaña.
    if (!r.qr_url) { p.skipped++; onProgress?.({ ...p }); continue; }
    try {
      const img = await renderGenericInvitation(event, { name: r.name, party_size: r.party_size, qr_url: r.qr_url }, settings, lang);
      const path = `${event.id}/invitations/${r.id}-${Date.now()}.${img.extension}`;
      const { error } = await supabase.storage.from('event-assets').upload(path, img.blob, { contentType: img.contentType, cacheControl: '31536000', upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from('event-assets').getPublicUrl(path);
      const { error: uErr } = await supabase.from('registrations').update({ invitation_url: data.publicUrl }).eq('id', r.id);
      if (uErr) throw new Error(uErr.message);
      if (r.invitation_url && r.invitation_url.includes('/event-assets/')) removeEventImage(r.invitation_url).catch(() => {});
      // La copia anterior en Drive queda obsoleta: se vuelve a subir en el espejo
      if (r.invitation_drive_id) await supabase.from('registrations').update({ invitation_drive_id: null, invitation_drive_url: null }).eq('id', r.id);
      p.done++;
    } catch {
      p.failed++;
    }
    onProgress?.({ ...p });
  }
  // Espejo en Drive; si no está configurado no es un error de la generación
  try {
    onProgress?.({ ...p, current: 'Copiando a Drive…' });
    await syncInvitationsToDrive(event.id, regs.map(r => r.id), s => onProgress?.({ ...p, current: `Drive ${s.done}${s.remaining ? ` (faltan ${s.remaining})` : ''}` }));
  } catch (e) {
    p.drive_error = (e as Error).message;
  }
  onProgress?.({ ...p, current: undefined });
  return p;
}

export interface DriveSyncProgress { done: number; failed: number; remaining: number; folder_url: string | null; errors: { id: string; message: string }[] }
export interface DriveSyncError extends Error { code?: string; service_account_email?: string }

/** Copia a Drive las invitaciones (de los ids dados o de todas) que aún no tienen copia; en lotes. */
export async function syncInvitationsToDrive(eventId: string, ids: string[] | null, onProgress?: (p: DriveSyncProgress) => void, action: 'sync' | 'remove' = 'sync'): Promise<DriveSyncProgress> {
  const total: DriveSyncProgress = { done: 0, failed: 0, remaining: 0, folder_url: null, errors: [] };
  for (let i = 0; i < 200; i++) {
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; code?: string; message?: string; service_account_email?: string } & DriveSyncProgress>('invitations-drive-sync', {
      body: { event_id: eventId, registration_ids: ids ?? undefined, action },
    });
    if (error || !data?.ok) {
      const err: DriveSyncError = new Error(data?.message || error?.message || 'No se pudo copiar a Drive');
      err.code = data?.code; err.service_account_email = data?.service_account_email;
      throw err;
    }
    total.done += data.done; total.failed += data.failed; total.remaining = data.remaining;
    total.folder_url = data.folder_url ?? total.folder_url;
    total.errors.push(...(data.errors ?? []));
    onProgress?.({ ...total });
    if (data.remaining === 0 || (data.done === 0 && data.failed > 0)) break;
  }
  return total;
}

/** Vuelve a dibujar y subir la invitación de un solo registro. */
export async function regenerateInvitation(event: EventRow, reg: Registration, settings: GenericInvitationSettings, lang: Lang): Promise<GenericProgress> {
  return generateGenericInvitations(event, [reg], settings, lang);
}

/** Quita la invitación: archivo del bucket, copia en Drive y columnas. El QR se conserva. */
export async function removeInvitation(reg: Registration): Promise<void> {
  if (reg.invitation_drive_id) {
    try { await syncInvitationsToDrive(reg.event_id, [reg.id], undefined, 'remove'); } catch { /* la copia se limpia abajo igual */ }
  }
  if (reg.invitation_url && reg.invitation_url.includes('/event-assets/')) await removeEventImage(reg.invitation_url).catch(() => {});
  const { error } = await supabase.from('registrations').update({ invitation_url: null, invitation_drive_id: null, invitation_drive_url: null }).eq('id', reg.id);
  if (error) throw new Error(error.message);
}

/** Descarga la invitación con un nombre legible (fetch → blob para forzar la descarga). */
export async function downloadInvitation(reg: Registration): Promise<void> {
  if (!reg.invitation_url) return;
  const res = await fetch(reg.invitation_url);
  if (!res.ok) throw new Error('No se pudo descargar la invitación');
  const blob = await res.blob();
  const ext = blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('pdf') ? 'pdf' : 'png';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `invitacion-${(reg.name ?? reg.id).replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || reg.id}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ─── Invitaciones ────────────────────────────────────────────

export async function inspectInvitationTemplate(eventFolderUrl: string): Promise<InspectResult | FunctionError> {
  const { data, error } = await supabase.functions.invoke<InspectResult | FunctionError>('invitations-inspect', { body: { event_folder_url: eventFolderUrl } });
  if (error || !data) return { ok: false, code: 'network', message: error?.message ?? 'Sin respuesta' };
  return data;
}

export interface BatchResult { ok: true; processed: number; failed: number; remaining: number; completed: boolean }

export async function runInvitationBatch(jobId: string): Promise<BatchResult | FunctionError> {
  const { data, error } = await supabase.functions.invoke<BatchResult | FunctionError>('invitations-run-batch', { body: { job_id: jobId } });
  if (error || !data) return { ok: false, code: 'network', message: error?.message ?? 'Sin respuesta' };
  return data;
}

// ─── Excel para el bot de WhatsApp ───────────────────────────

/** Columnas fijas que el bot ya reconoce. */
export const BOT_COLUMNS = ['Nombre', 'Telefono', 'N.boletos', 'Confirmados', 'Invitación', 'ConfirmationLink'] as const;

export interface ExcelOptions {
  /** Preguntas extra como columnas (variables para las plantillas de Meta). */
  questionIds: string[];
  includeEmail: boolean;
  includeQr: boolean;
}

export function buildBotRows(regs: Registration[], schema: FormSchema | null, lang: Lang, opts: ExcelOptions): Record<string, string | number>[] {
  const qs = (schema?.questions ?? []).filter(q => opts.questionIds.includes(q.id));
  return regs.map(r => {
    const row: Record<string, string | number> = {
      'Nombre': r.name ?? '',
      'Telefono': (r.phone ?? '').replace(/\D/g, ''),
      'N.boletos': r.party_size ?? 1,
      'Confirmados': '',
      'Invitación': r.invitation_url ?? '',
      'ConfirmationLink': '',
    };
    if (opts.includeEmail) row['Correo'] = r.email ?? '';
    if (opts.includeQr) row['QR'] = r.qr_url ?? '';
    for (const q of qs) {
      const header = (text(q.title, lang) || q.id).replace(/[\r\n]+/g, ' ').slice(0, 60);
      row[header] = answerText(q, r.answers[q.id], lang);
    }
    return row;
  });
}

export function buildBotExcelName(slug: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${slug}-whatsapp-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
}

export function downloadBotExcel(fileName: string, rows: Record<string, string | number>[]) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...BOT_COLUMNS, ...Object.keys(rows[0] ?? {}).filter(k => !(BOT_COLUMNS as readonly string[]).includes(k))] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Invitados');
  XLSX.writeFile(wb, fileName);
}

/** Deja constancia en la bitácora de que se exportaron para WhatsApp. */
export async function logWhatsappExport(eventId: string, regs: Registration[]) {
  if (regs.length === 0) return;
  const rows = regs.map(r => ({
    event_id: eventId,
    registration_id: r.id,
    channel: 'whatsapp',
    trigger: 'export',
    to_address: r.phone,
    subject: 'Excel para We Bot',
    status: 'exported',
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await supabase.from('messages').insert(rows.slice(i, i + 200));
  }
}
