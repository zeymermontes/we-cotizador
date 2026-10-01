// Sesión de Supabase del usuario que corre el MCP. Entra con correo y
// contraseña (variables de entorno) y RLS decide qué eventos ve y edita.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

export class McpError extends Error {
  constructor(message: string, public code = 'error') { super(message); }
}

let client: SupabaseClient | null = null;
let profile: { id: string; email: string; role: 'super' | 'event_admin' } | null = null;

export async function getClient(): Promise<SupabaseClient> {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;
  if (!url || !anon) throw new McpError('Faltan SUPABASE_URL y SUPABASE_ANON_KEY en mcp/.env', 'config');
  if (!email || !password) throw new McpError('Faltan SUPABASE_EMAIL y SUPABASE_PASSWORD en mcp/.env (el MCP entra como ese usuario)', 'config');

  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new McpError(`No se pudo iniciar sesión en Supabase: ${error?.message ?? 'sin usuario'}`, 'auth');
  const { data: p } = await c.from('profiles').select('id, email, role').eq('id', data.user.id).maybeSingle();
  profile = { id: data.user.id, email: data.user.email ?? email, role: (p?.role as 'super' | 'event_admin') ?? 'event_admin' };
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
