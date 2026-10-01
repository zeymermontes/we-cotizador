// Credenciales guardadas por `setup`: nunca la contraseña, solo el
// refresh token de Supabase (se rota solo). Archivo con permisos 600.
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoredCredentials {
  url: string;
  anon_key: string;
  refresh_token: string;
  email: string;
  saved_at: string;
}

export const CREDENTIALS_DIR = join(homedir(), '.we-eventos-mcp');
export const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'credentials.json');

export function loadCredentials(): StoredCredentials | null {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return null;
    const c = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as StoredCredentials;
    return c.refresh_token && c.url && c.anon_key ? c : null;
  } catch { return null; }
}

export function saveCredentials(c: StoredCredentials) {
  mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
  try { chmodSync(CREDENTIALS_FILE, 0o600); } catch { /* windows */ }
}

export function clearCredentials() {
  try { writeFileSync(CREDENTIALS_FILE, '{}', { mode: 0o600 }); } catch { /* nada */ }
}
