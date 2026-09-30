// Cliente del scanner de acceso (página pública acceso.we.page/<slug>).
import { supabase } from './supabase';
import type { PublicEvent } from './events-types';

export interface ScannerGuest {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  party_size: number;
  status: string;
  tags: string[];
  notes: string | null;
  entered: number;
  last_at: string | null;
}

export type ScanResult =
  | { result: 'ok'; guest: ScannerGuest; check_in_id: string; admitted: number }
  | { result: 'duplicate'; guest: ScannerGuest }
  | { result: 'cancelled'; guest: ScannerGuest }
  | { result: 'invalid' };

export interface ScannerStats {
  registrations: number;
  expected_people: number;
  entered_registrations: number;
  entered_people: number;
}

export interface RecentCheckIn { id: string; name: string; count: number; at: string; method: string }

export interface ScannerSession {
  token: string;
  expires_at: string;
  event: PublicEvent & { id: string };
}

type Fail = { ok: false; code: string; message: string };

const storageKey = (slug: string) => `we-scanner-${slug}`;

export function loadSession(slug: string): ScannerSession | null {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return null;
    const s = JSON.parse(raw) as ScannerSession;
    if (new Date(s.expires_at) < new Date()) { localStorage.removeItem(storageKey(slug)); return null; }
    return s;
  } catch { return null; }
}

export function saveSession(slug: string, s: ScannerSession | null) {
  try {
    if (s) localStorage.setItem(storageKey(slug), JSON.stringify(s));
    else localStorage.removeItem(storageKey(slug));
  } catch { /* sin storage */ }
}

export async function openSession(slug: string, pin: string, device: string): Promise<ScannerSession | Fail> {
  const { data, error } = await supabase.functions.invoke<({ ok: true } & ScannerSession) | Fail>('scanner-session', { body: { slug, pin, device } });
  if (error || !data) return { ok: false, code: 'network', message: 'Sin conexión. Intenta de nuevo.' };
  if (!data.ok) return data;
  return { token: data.token, expires_at: data.expires_at, event: data.event };
}

async function call<T>(token: string, action: string, extra: Record<string, unknown> = {}): Promise<T | Fail> {
  const { data, error } = await supabase.functions.invoke<(T & { ok: true }) | Fail>('scanner-checkin', { body: { token, action, ...extra } });
  if (error || !data) return { ok: false, code: 'network', message: 'Sin conexión. Intenta de nuevo.' };
  if (!data.ok) return data;
  return data;
}

export const scanCode = (token: string, code: string) => call<ScanResult>(token, 'scan', { code });
export const manualCheckIn = (token: string, registrationId: string) => call<ScanResult>(token, 'manual', { registration_id: registrationId });
export const searchGuests = (token: string, q: string) => call<{ results: ScannerGuest[] }>(token, 'search', { q });
export const scannerStats = (token: string) => call<{ stats: ScannerStats; recent: RecentCheckIn[] }>(token, 'stats');
export const undoCheckIn = (token: string, checkInId: string) => call<{ ok: true }>(token, 'undo', { check_in_id: checkInId });

export const isFail = (r: unknown): r is Fail => !!r && typeof r === 'object' && (r as Fail).ok === false;

export const SCANNER_TEXT = {
  es: {
    title: 'Control de acceso', subtitle: 'Escribe el PIN del staff para empezar a escanear.', device: 'Nombre de este dispositivo (opcional)',
    enter: 'Entrar', wrong: 'PIN incorrecto', scanning: 'Apunta la cámara al QR', manual: 'Buscar por nombre', search: 'Nombre, correo o teléfono…',
    ok: 'Adelante', duplicate: 'Ya entró', cancelled: 'Registro cancelado', invalid: 'QR no válido', people: 'personas', person: 'persona',
    entered: 'Entraron', of: 'de', at: 'a las', admit: 'Dar acceso', undo: 'Deshacer', logout: 'Salir', camera_error: 'No se pudo abrir la cámara. Revisa los permisos o usa la búsqueda manual.',
    stats: 'Asistencia', expected: 'esperados', noResults: 'Sin resultados', notes: 'Nota',
  },
  en: {
    title: 'Check-in', subtitle: 'Enter the staff PIN to start scanning.', device: 'This device name (optional)',
    enter: 'Enter', wrong: 'Wrong PIN', scanning: 'Point the camera at the QR', manual: 'Search by name', search: 'Name, email or phone…',
    ok: 'Welcome', duplicate: 'Already in', cancelled: 'Cancelled registration', invalid: 'Invalid QR', people: 'people', person: 'person',
    entered: 'Entered', of: 'of', at: 'at', admit: 'Admit', undo: 'Undo', logout: 'Log out', camera_error: 'Could not open the camera. Check permissions or use manual search.',
    stats: 'Attendance', expected: 'expected', noResults: 'No results', notes: 'Note',
  },
};
