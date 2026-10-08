// Sesión de Supabase del usuario que corre el MCP. RLS decide qué
// eventos ve y edita. Orden de credenciales:
//   1. ~/.we-eventos-mcp/credentials.json (lo crea `node bin.js setup`)
//   2. variables de entorno SUPABASE_EMAIL + SUPABASE_PASSWORD (mcp/.env)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCredentials, saveCredentials } from './credentials.ts';

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

export class McpError extends Error {
  constructor(message: string, public code = 'error') { super(message); }
}

let client: SupabaseClient | null = null;
let profile: { id: string; email: string; role: 'super' | 'event_admin' } | null = null;

// Proyecto de We.Page Eventos. La clave anon es pública (va en el sitio);
// quien manda es la sesión del usuario y las políticas RLS.
const DEFAULT_URL = 'https://ancnlambjsqattfgrjyt.supabase.co';
const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFuY25sYW1ianNxYXR0Zmdyanl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDk2MTYsImV4cCI6MjA5MjAyNTYxNn0.JcDlY6Ke9DfS2P-iaOLARzych9aedt0pefQ-K4JZG6w';

export function projectConfig(): { url: string; anon: string } {
  const stored = loadCredentials();
  const url = process.env.SUPABASE_URL || stored?.url || DEFAULT_URL;
  const anon = process.env.SUPABASE_ANON_KEY || stored?.anon_key || DEFAULT_ANON;
  return { url, anon };
}

export async function getClient(): Promise<SupabaseClient> {
  if (client) return client;
  const { url, anon } = projectConfig();
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } });

  const stored = loadCredentials();
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;

  let userEmail = '';
  let userId = '';

  if (stored?.refresh_token) {
    const { data, error } = await c.auth.refreshSession({ refresh_token: stored.refresh_token });
    if (error || !data.session || !data.user) {
      throw new McpError(`La sesión guardada ya no sirve (${error?.message ?? 'sin sesión'}). Vuelve a correr: node bin.js setup`, 'auth');
    }
    userEmail = data.user.email ?? stored.email;
    userId = data.user.id;
    saveCredentials({ ...stored, refresh_token: data.session.refresh_token, email: userEmail, saved_at: new Date().toISOString() });
    // Supabase rota el refresh token: guardamos siempre el último
    c.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.refresh_token) {
        saveCredentials({ url, anon_key: anon, refresh_token: session.refresh_token, email: userEmail, saved_at: new Date().toISOString() });
      }
    });
  } else if (email && password) {
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new McpError(`No se pudo iniciar sesión en Supabase: ${error?.message ?? 'sin usuario'}`, 'auth');
    userEmail = data.user.email ?? email;
    userId = data.user.id;
  } else {
    throw new McpError('No hay sesión. Corre `node bin.js setup` para iniciar sesión (o pon SUPABASE_EMAIL y SUPABASE_PASSWORD en mcp/.env).', 'auth');
  }

  const { data: p } = await c.from('profiles').select('id, email, role').eq('id', userId).maybeSingle();
  profile = { id: userId, email: userEmail, role: (p?.role as 'super' | 'event_admin') ?? 'event_admin' };
  client = c;
  return c;
}

export async function getProfile() {
  await getClient();
  return profile!;
}

export async function isSuper(): Promise<boolean> {
  return (await getProfile()).role === 'super';
}

/** Deja constancia de lo que hizo la IA (tabla mcp_audit; si no existe, se ignora). */
export async function audit(tool: string, args: unknown, result: 'ok' | 'error', detail?: string) {
  try {
    const c = await getClient();
    const p = await getProfile();
    await c.from('mcp_audit').insert({
      user_id: p.id,
      tool,
      args: JSON.parse(JSON.stringify(args ?? {}, (_k, v) => (typeof v === 'string' && v.length > 500 ? v.slice(0, 500) + '…' : v))),
      result,
      detail: detail?.slice(0, 1000) ?? null,
    });
  } catch { /* la auditoría nunca rompe la herramienta */ }
}
