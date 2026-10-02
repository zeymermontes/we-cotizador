// Herramientas del MCP. Cada una habla con Supabase como el usuario
// que corre el servidor; RLS decide alcance. Las acciones con
// consecuencias piden `confirm: true` y tienen límites por llamada.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, getProfile, isSuper, audit, McpError } from './client.ts';
import { FORM_SCHEMA_GUIDE } from './guide.ts';
import {
  type FormSchema, type Question, type Lang, normalizeSchema, validateSchema, text, uid, slugifyLike,
} from './shared.ts';
import { allColumns, applyView, cellText, DEFAULT_VIEW, STATUS_ORDER, type Registration, type Filter, type ColumnKey } from '../../src/lib/registrations.ts';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const err = (message: string): ToolResult => ({ content: [{ type: 'text', text: `Error: ${message}` }], isError: true });

/** Envuelve una herramienta: errores legibles + auditoría. */
function wrap<A>(name: string, fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      const data = await fn(args);
      await audit(name, args, 'ok');
      return ok(data);
    } catch (e) {
      const message = e instanceof McpError ? e.message : (e as Error).message ?? String(e);
      await audit(name, args, 'error', message);
      return err(message);
    }
  };
}

async function findEvent(ref: string) {
  const c = await getClient();
  const isUuid = /^[0-9a-f-]{36}$/i.test(ref);
  const { data, error } = await c.from('events').select('*').eq(isUuid ? 'id' : 'slug', ref).maybeSingle();
  if (error) throw new McpError(error.message);
  if (!data) throw new McpError(`No encuentro el evento "${ref}" (o no tienes acceso). Usa list_events.`);
  return data;
}

async function loadSchema(eventId: string): Promise<{ draft: FormSchema | null; published: FormSchema | null; version: number | null }> {
  const c = await getClient();
  const { data: f } = await c.from('event_forms').select('draft, published_version').eq('event_id', eventId).maybeSingle();
  if (!f) return { draft: null, published: null, version: null };
  let published: FormSchema | null = null;
  if (f.published_version) {
    const { data: v } = await c.from('form_versions').select('schema').eq('event_id', eventId).eq('version', f.published_version).maybeSingle();
    if (v) published = normalizeSchema(v.schema);
  }
  return { draft: normalizeSchema(f.draft), published, version: f.published_version };
}

function summarizeQuestions(schema: FormSchema, lang: Lang) {
  return schema.questions.map((q, i) => ({
    n: i + 1, id: q.id, type: q.type, title: text(q.title, lang), required: q.required,
    identity: q.identity ?? undefined,
    options: q.options?.map(o => ({ id: o.id, label: text(o.label, lang) })),
    showIf: q.showIf ?? undefined,
    logic: q.logic?.length ? q.logic : undefined,
  }));
}

/** Completa ids y defaults de un esquema que viene de la IA. */
function fillIds(schema: FormSchema): FormSchema {
  return {
    ...schema,
    questions: schema.questions.map((q: Question) => ({
      ...q,
      required: q.required ?? true,
      id: q.id || uid('q'),
      options: q.options?.map(o => ({ ...o, id: o.id || uid('o') })),
      logic: q.logic?.map(r => ({ ...r, id: r.id || uid('r') })),
    })),
  };
}

const EVENT_FIELDS = 'id, slug, name, status, event_date, timezone, venue, languages, default_language, login_method, capacity, registration_closes_at, sender_name, reply_to, created_at';

export function registerTools(server: McpServer) {
  // ─── Contexto ────────────────────────────────────────────
  server.registerTool('whoami', {
    title: 'Quién soy',
    description: 'Usuario con el que está conectado el MCP y su rol (super = equipo We.Page, event_admin = solo sus eventos).',
    inputSchema: {},
  }, wrap('whoami', async () => getProfile()));

  server.registerTool('describe_form_schema', {
    title: 'Referencia del esquema de formulario',
    description: 'Devuelve la guía del JSON de formularios (tipos de pregunta, lógica condicional, identidades). Léela antes de crear o modificar un formulario.',
    inputSchema: {},
  }, wrap('describe_form_schema', async () => FORM_SCHEMA_GUIDE));

  // ─── Eventos ─────────────────────────────────────────────
  server.registerTool('list_events', {
    title: 'Listar eventos',
    description: 'Eventos a los que el usuario tiene acceso, con conteo de registros.',
    inputSchema: { status: z.enum(['draft', 'published', 'closed', 'archived']).optional().describe('Filtrar por estatus') },
  }, wrap('list_events', async ({ status }) => {
    const c = await getClient();
    let q = c.from('events').select(EVENT_FIELDS).order('event_date', { ascending: true, nullsFirst: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new McpError(error.message);
    const { data: regs } = await c.from('registrations').select('event_id, status');
    const counts = new Map<string, { total: number; checked_in: number }>();
    for (const r of regs ?? []) {
      const cur = counts.get(r.event_id) ?? { total: 0, checked_in: 0 };
      if (r.status !== 'cancelled') cur.total++;
      if (r.status === 'checked_in') cur.checked_in++;
      counts.set(r.event_id, cur);
    }
    return (data ?? []).map(e => ({ ...e, registrations: counts.get(e.id)?.total ?? 0, checked_in: counts.get(e.id)?.checked_in ?? 0 }));
  }));

  server.registerTool('get_event', {
    title: 'Ver evento',
    description: 'Detalle completo de un evento por id o slug: datos, branding, textos de pantallas, estado del formulario, estadísticas y enlaces públicos.',
    inputSchema: { event: z.string().describe('id o slug del evento') },
  }, wrap('get_event', async ({ event }) => {
    const c = await getClient();
    const ev = await findEvent(event);
    const { draft, published, version } = await loadSchema(ev.id);
    const { data: regs } = await c.from('registrations').select('status, party_size').eq('event_id', ev.id);
    const byStatus: Record<string, number> = {};
    let people = 0;
    for (const r of regs ?? []) { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; if (r.status !== 'cancelled') people += r.party_size ?? 1; }
    const { scanner_pin_hash: _pin, ...safe } = ev;
    return {
      ...safe,
      urls: { registro: `https://registro.we.page/${ev.slug}`, acceso: `https://acceso.we.page/${ev.slug}`, panel: `https://panel.we.page/eventos/${ev.id}` },
      form: { published_version: version, draft_questions: draft?.questions.length ?? 0, published_questions: published?.questions.length ?? 0, has_unpublished_changes: !!draft && JSON.stringify(draft) !== JSON.stringify(published) },
      stats: { registrations: (regs ?? []).filter(r => r.status !== 'cancelled').length, people, by_status: byStatus },
    };
  }));

  server.registerTool('create_event', {
    title: 'Crear evento',
    description: 'Crea un evento en borrador (solo equipo We.Page). Después usa update_form_draft para armar el formulario y update_event para publicar.',
    inputSchema: {
      name: z.string().min(2),
      slug: z.string().optional().describe('Enlace; se deriva del nombre si falta'),
      event_date: z.string().optional().describe('ISO 8601, ej. 2026-11-20T19:00:00-06:00'),
      venue: z.string().optional(),
      languages: z.array(z.enum(['es', 'en'])).min(1).default(['es']),
      default_language: z.enum(['es', 'en']).optional(),
      capacity: z.number().int().positive().optional(),
      description: z.string().optional(),
    },
  }, wrap('create_event', async (a) => {
    if (!(await isSuper())) throw new McpError('Solo el equipo We.Page puede crear eventos.');
    const c = await getClient();
    const p = await getProfile();
    const slug = slugifyLike(a.slug || a.name);
    const { data, error } = await c.from('events').insert({
      name: a.name.trim(), slug, event_date: a.event_date ?? null, venue: a.venue ?? null, description: a.description ?? null,
      languages: a.languages, default_language: a.default_language && a.languages.includes(a.default_language) ? a.default_language : a.languages[0],
      login_method: 'password', capacity: a.capacity ?? null, created_by: p.id,
    }).select(EVENT_FIELDS).single();
    if (error) throw new McpError(error.message.includes('events_slug_key') ? `El enlace "${slug}" ya está en uso.` : error.message);
    return data;
  }));

  server.registerTool('update_event', {
    title: 'Modificar evento',
    description: 'Cambia datos del evento. Publicar, cerrar o archivar requiere confirm: true. Para branding y textos de pantallas pasa los objetos completos.',
    inputSchema: {
      event: z.string().describe('id o slug'),
      name: z.string().optional(),
      slug: z.string().optional(),
      description: z.string().nullable().optional(),
      event_date: z.string().nullable().optional(),
      venue: z.string().nullable().optional(),
      capacity: z.number().int().positive().nullable().optional(),
      registration_closes_at: z.string().nullable().optional(),
      languages: z.array(z.enum(['es', 'en'])).min(1).optional(),
      default_language: z.enum(['es', 'en']).optional(),
      status: z.enum(['draft', 'published', 'closed', 'archived']).optional(),
      sender_name: z.string().nullable().optional(),
      reply_to: z.string().nullable().optional(),
      branding: z.record(z.unknown()).optional().describe('{ logo_url, background_url, primary, background, surface, text, font_display, font_body, button_radius }'),
      screens: z.record(z.unknown()).optional().describe('{ welcome: {title:{es,en}, subtitle, button, elements}, thank_you: {title, subtitle, elements}, scanner: {title, subtitle, elements} }. elements: { <logo|title|date|venue|subtitle|button|hint|check|name|powered (en footer)>: { show?, size? (px), bold?, italic?, underline?, uppercase?, color? (hex), opacity? (0-100), font? (display|body|nombre de Google Font) } } para ocultar o cambiar el tamaño de cada elemento.'),
      confirm: z.boolean().optional().describe('Obligatorio para cambiar status'),
    },
  }, wrap('update_event', async ({ event, confirm, ...fields }) => {
    const c = await getClient();
    const ev = await findEvent(event);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = v;
    if (patch.slug) patch.slug = slugifyLike(String(patch.slug));
    if (patch.status && patch.status !== ev.status && !confirm) throw new McpError(`Cambiar el estatus a "${patch.status}" requiere confirm: true.`);
    if (patch.branding) patch.branding = { ...(ev.branding ?? {}), ...(patch.branding as object) };
    if (patch.screens) patch.screens = { ...(ev.screens ?? {}), ...(patch.screens as object) };
    if (Object.keys(patch).length === 0) throw new McpError('No hay cambios.');
    const { data, error } = await c.from('events').update(patch).eq('id', ev.id).select(EVENT_FIELDS).single();
    if (error) throw new McpError(error.message);
    return data;
  }));

  server.registerTool('set_event_image', {
    title: 'Poner logo o fondo del evento',
    description: 'Descarga una imagen desde una URL (o la lee de un archivo local), la sube al bucket del evento y la deja como logo o fondo del branding. Máximo 3 MB; jpg, png, webp o svg.',
    inputSchema: {
      event: z.string(),
      kind: z.enum(['logo', 'background']),
      source_url: z.string().optional().describe('URL pública de la imagen'),
      file_path: z.string().optional().describe('Ruta local absoluta (alternativa a source_url)'),
    },
  }, wrap('set_event_image', async (a) => {
    const c = await getClient();
    const ev = await findEvent(a.event);
    let bytes: Uint8Array; let contentType = '';
    if (a.source_url) {
      const res = await fetch(a.source_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new McpError(`No pude descargar la imagen (${res.status})`);
      contentType = res.headers.get('content-type')?.split(';')[0] ?? '';
      bytes = new Uint8Array(await res.arrayBuffer());
    } else if (a.file_path) {
      const { readFile } = await import('node:fs/promises');
      bytes = new Uint8Array(await readFile(a.file_path));
      const ext = a.file_path.split('.').pop()?.toLowerCase();
      contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
    } else throw new McpError('Indica source_url o file_path.');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(contentType)) throw new McpError(`Tipo no permitido: ${contentType || 'desconocido'}`);
    if (bytes.byteLength > 3 * 1024 * 1024) throw new McpError('La imagen pesa más de 3 MB; comprímela primero.');
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : contentType === 'image/svg+xml' ? 'svg' : 'jpg';
    const path = `${ev.id}/${a.kind}/${a.kind}-${Date.now()}.${ext}`;
    const { error } = await c.storage.from('event-assets').upload(path, bytes, { contentType, cacheControl: '31536000', upsert: false });
    if (error) throw new McpError(error.message);
    const { data: pub } = c.storage.from('event-assets').getPublicUrl(path);
    const key = a.kind === 'logo' ? 'logo_url' : 'background_url';
    const branding = { ...(ev.branding ?? {}), [key]: pub.publicUrl };
    const { error: uErr } = await c.from('events').update({ branding }).eq('id', ev.id);
    if (uErr) throw new McpError(uErr.message);
    return { [key]: pub.publicUrl, bytes: bytes.byteLength, contentType };
  }));

  // ─── Formulario ──────────────────────────────────────────
  server.registerTool('get_form', {
    title: 'Ver formulario',
    description: 'Borrador y versión publicada del formulario de un evento. Con full: true devuelve el JSON completo (para editarlo y mandarlo a update_form_draft).',
    inputSchema: { event: z.string(), full: z.boolean().optional() },
  }, wrap('get_form', async ({ event, full }) => {
    const ev = await findEvent(event);
    const { draft, published, version } = await loadSchema(ev.id);
    const lang = ev.default_language as Lang;
    if (full) return { published_version: version, draft, published };
    return {
      published_version: version,
      languages: ev.languages,
      draft: draft ? { settings: draft.settings, questions: summarizeQuestions(draft, lang) } : null,
      published: published ? { questions: summarizeQuestions(published, lang) } : null,
      issues: draft ? validateSchema(draft, ev.languages as Lang[]) : [],
    };
  }));

  server.registerTool('update_form_draft', {
    title: 'Guardar borrador del formulario',
    description: 'Reemplaza el borrador completo con el esquema dado (lee describe_form_schema primero). Valida y rechaza si hay errores; no publica. Para cambios pequeños: get_form full, edita, y manda todo de vuelta.',
    inputSchema: {
      event: z.string(),
      schema: z.object({ v: z.literal(1).optional(), questions: z.array(z.record(z.unknown())), settings: z.record(z.unknown()).optional() }),
    },
  }, wrap('update_form_draft', async ({ event, schema }) => {
    const c = await getClient();
    const p = await getProfile();
    const ev = await findEvent(event);
    const normalized = fillIds(normalizeSchema(schema));
    const issues = validateSchema(normalized, ev.languages as Lang[]);
    const errors = issues.filter(i => i.level === 'error');
    if (errors.length) throw new McpError(`El formulario tiene errores:\n- ${errors.map(e => e.message).join('\n- ')}`);
    const { error } = await c.from('event_forms').upsert({ event_id: ev.id, draft: normalized, updated_by: p.id }, { onConflict: 'event_id' });
    if (error) throw new McpError(error.message);
    return { saved: true, questions: normalized.questions.length, warnings: issues.map(i => i.message), next: 'Usa publish_form con confirm: true para que el público lo vea.' };
  }));

  server.registerTool('publish_form', {
    title: 'Publicar formulario',
    description: 'Congela el borrador como nueva versión publicada. Requiere confirm: true.',
    inputSchema: { event: z.string(), confirm: z.boolean() },
  }, wrap('publish_form', async ({ event, confirm }) => {
    if (!confirm) throw new McpError('Requiere confirm: true.');
    const c = await getClient();
    const ev = await findEvent(event);
    const { draft } = await loadSchema(ev.id);
    if (!draft) throw new McpError('El evento no tiene formulario todavía.');
    const errors = validateSchema(draft, ev.languages as Lang[]).filter(i => i.level === 'error');
    if (errors.length) throw new McpError(`No se puede publicar:\n- ${errors.map(e => e.message).join('\n- ')}`);
    const { data, error } = await c.rpc('publish_event_form', { p_event_id: ev.id });
    if (error) throw new McpError(error.message);
    return { published_version: data, event_status: ev.status, note: ev.status !== 'published' ? 'El evento sigue sin publicarse: usa update_event con status published y confirm true.' : undefined };
  }));

  // ─── Registros ───────────────────────────────────────────
  server.registerTool('list_registrations', {
    title: 'Listar registros',
    description: 'Registros de un evento con búsqueda y filtros (los mismos del panel). Las columnas "q:<questionId>" filtran por respuesta. Devuelve hasta `limit` filas y el total que coincide.',
    inputSchema: {
      event: z.string(),
      search: z.string().optional(),
      status: z.enum(['registered', 'waitlist', 'selected', 'invited', 'confirmed', 'checked_in', 'cancelled']).optional(),
      filters: z.array(z.object({
        column: z.string().describe('name | email | phone | party_size | company | status | tags | lang | created_at | q:<questionId>'),
        op: z.enum(['eq', 'neq', 'contains', 'not_contains', 'gt', 'lt', 'gte', 'lte', 'empty', 'not_empty', 'before', 'after']),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
      })).optional(),
      match: z.enum(['all', 'any']).default('all'),
      limit: z.number().int().min(1).max(500).default(50),
      include_answers: z.boolean().default(false).describe('Incluir todas las respuestas legibles'),
    },
  }, wrap('list_registrations', async (a) => {
    const c = await getClient();
    const ev = await findEvent(a.event);
    const { published, draft } = await loadSchema(ev.id);
    const schema = published ?? draft;
    const lang = ev.default_language as Lang;
    const { data, error } = await c.from('registrations').select('*').eq('event_id', ev.id).order('created_at', { ascending: false });
    if (error) throw new McpError(error.message);
    const filters: Filter[] = [...(a.filters ?? []).map((f, i) => ({ id: `f${i}`, column: f.column as ColumnKey, op: f.op, value: f.value }))];
    if (a.status) filters.push({ id: 'st', column: 'status', op: 'eq', value: a.status });
    const rows = applyView((data ?? []) as Registration[], { ...DEFAULT_VIEW, search: a.search ?? '', match: a.match, filters }, schema, lang);
    const cols = allColumns(schema, lang).filter(c => c.question);
    return {
      total: rows.length,
      people: rows.reduce((s, r) => s + (r.status === 'cancelled' ? 0 : r.party_size ?? 1), 0),
      rows: rows.slice(0, a.limit).map(r => ({
        id: r.id, name: r.name, email: r.email, phone: r.phone, party_size: r.party_size, company: r.company,
        status: r.status, tags: r.tags, notes: r.notes ?? undefined, lang: r.lang, created_at: r.created_at,
        has_qr: !!r.qr_url, has_invitation: !!r.invitation_url,
        ...(a.include_answers ? { answers: Object.fromEntries(cols.map(col => [col.label, cellText(r, col, lang)])) } : {}),
      })),
    };
  }));

  server.registerTool('get_registration', {
    title: 'Ver registro',
    description: 'Un registro con todas sus respuestas y sus mensajes enviados.',
    inputSchema: { registration_id: z.string() },
  }, wrap('get_registration', async ({ registration_id }) => {
    const c = await getClient();
    const { data: r, error } = await c.from('registrations').select('*').eq('id', registration_id).maybeSingle();
    if (error) throw new McpError(error.message);
    if (!r) throw new McpError('No encuentro ese registro.');
    const { data: ev } = await c.from('events').select('default_language').eq('id', r.event_id).maybeSingle();
    const { published, draft } = await loadSchema(r.event_id);
    const schema = published ?? draft;
    const lang = (ev?.default_language ?? 'es') as Lang;
    const cols = allColumns(schema, lang).filter(c => c.question);
    const { data: msgs } = await c.from('messages').select('channel, trigger, subject, status, created_at').eq('registration_id', r.id).order('created_at', { ascending: false });
    return { ...r, answers_readable: Object.fromEntries(cols.map(col => [col.label, cellText(r as Registration, col, lang)])), messages: msgs ?? [] };
  }));

  server.registerTool('update_registrations', {
    title: 'Modificar registros',
    description: 'Cambia estatus, etiquetas o notas de uno o varios registros (máximo 200). Más de 20 requiere confirm: true.',
    inputSchema: {
      registration_ids: z.array(z.string()).min(1).max(200),
      status: z.enum(['registered', 'waitlist', 'selected', 'invited', 'confirmed', 'checked_in', 'cancelled']).optional(),
      add_tags: z.array(z.string()).optional(),
      remove_tags: z.array(z.string()).optional(),
      notes: z.string().nullable().optional().describe('Reemplaza las notas (solo si es un registro)'),
      confirm: z.boolean().optional(),
    },
  }, wrap('update_registrations', async (a) => {
    if (a.registration_ids.length > 20 && !a.confirm) throw new McpError(`Son ${a.registration_ids.length} registros: requiere confirm: true.`);
    const c = await getClient();
    const { data: rows, error } = await c.from('registrations').select('id, tags').in('id', a.registration_ids);
    if (error) throw new McpError(error.message);
    if (!rows?.length) throw new McpError('No encuentro esos registros.');
    let changed = 0;
    for (const r of rows) {
      const patch: Record<string, unknown> = {};
      if (a.status) patch.status = a.status;
      if (a.add_tags || a.remove_tags) {
        const tags = new Set<string>(r.tags ?? []);
        a.add_tags?.forEach(t => tags.add(t.trim()));
        a.remove_tags?.forEach(t => tags.delete(t.trim()));
        patch.tags = Array.from(tags).filter(Boolean);
      }
      if (a.notes !== undefined && rows.length === 1) patch.notes = a.notes;
      if (Object.keys(patch).length === 0) continue;
      const { error: uErr } = await c.from('registrations').update(patch).eq('id', r.id);
      if (uErr) throw new McpError(uErr.message);
      changed++;
    }
    return { changed, not_found: a.registration_ids.length - rows.length };
  }));

  server.registerTool('create_registration', {
    title: 'Registro manual',
    description: 'Agrega un invitado a mano (sin pasar por el formulario).',
    inputSchema: {
      event: z.string(), name: z.string().min(1), email: z.string().optional(), phone: z.string().optional(),
      party_size: z.number().int().min(1).default(1), company: z.string().optional(),
      status: z.enum(STATUS_ORDER as [string, ...string[]]).default('registered'), tags: z.array(z.string()).optional(),
    },
  }, wrap('create_registration', async (a) => {
    const c = await getClient();
    const ev = await findEvent(a.event);
    const { data, error } = await c.from('registrations').insert({
      event_id: ev.id, name: a.name.trim(), email: a.email?.trim().toLowerCase() || null, phone: a.phone?.replace(/[^\d+]/g, '') || null,
      party_size: a.party_size, company: a.company ?? null, status: a.status, tags: a.tags ?? [], lang: ev.default_language, source: { ref: 'mcp' },
    }).select('id, name, status').single();
    if (error) throw new McpError(error.message);
    return data;
  }));

  // ─── Comunicaciones ──────────────────────────────────────
  server.registerTool('list_templates', {
    title: 'Plantillas de correo',
    description: 'Plantillas de correo del evento y sus automatizaciones.',
    inputSchema: { event: z.string() },
  }, wrap('list_templates', async ({ event }) => {
    const c = await getClient();
    const ev = await findEvent(event);
    const [{ data: t }, { data: a }] = await Promise.all([
      c.from('message_templates').select('id, name, channel, subject, body, updated_at').eq('event_id', ev.id).order('created_at'),
      c.from('automations').select('trigger, template_id, enabled, days_before').eq('event_id', ev.id),
    ]);
    return { templates: t ?? [], automations: a ?? [] };
  }));

  server.registerTool('upsert_template', {
    title: 'Crear o editar plantilla de correo',
    description: 'Crea (sin id) o edita (con id) una plantilla. Variables: {{nombre}}, {{primer_nombre}}, {{correo}}, {{telefono}}, {{personas}}, {{empresa}}, {{evento}}, {{fecha}}, {{hora}}, {{lugar}}, {{qr_url}}, {{invitacion_url}}, {{q:<questionId>}}. El cuerpo es texto: línea en blanco = párrafo, **negritas**, [texto](url).',
    inputSchema: {
      event: z.string(), id: z.string().optional(), name: z.string().optional(),
      subject: z.record(z.string()).optional().describe('{ es, en }'),
      body: z.record(z.string()).optional().describe('{ es, en }'),
      attach_invitation: z.boolean().optional().describe('Adjuntar la invitación del registro como archivo'),
      attach_qr: z.boolean().optional().describe('Adjuntar el QR del registro como archivo'),
    },
  }, wrap('upsert_template', async (a) => {
    const c = await getClient();
    const p = await getProfile();
    const ev = await findEvent(a.event);
    if (a.id) {
      const patch: Record<string, unknown> = {};
      if (a.name) patch.name = a.name;
      if (a.subject) patch.subject = a.subject;
      if (a.body) patch.body = a.body;
      if (a.attach_invitation !== undefined) patch.attach_invitation = a.attach_invitation;
      if (a.attach_qr !== undefined) patch.attach_qr = a.attach_qr;
      const { data, error } = await c.from('message_templates').update(patch).eq('id', a.id).eq('event_id', ev.id).select('id, name').single();
      if (error) throw new McpError(error.message);
      return data;
    }
    if (!a.name || !a.subject || !a.body) throw new McpError('Para crear: name, subject y body.');
    const { data, error } = await c.from('message_templates').insert({ event_id: ev.id, channel: 'email', name: a.name, subject: a.subject, body: a.body, attach_invitation: !!a.attach_invitation, attach_qr: !!a.attach_qr, created_by: p.id }).select('id, name').single();
    if (error) throw new McpError(error.message);
    return data;
  }));

  server.registerTool('set_automation', {
    title: 'Configurar automatización',
    description: 'Activa o desactiva el envío automático de una plantilla por disparador.',
    inputSchema: {
      event: z.string(),
      trigger: z.enum(['on_register', 'on_waitlist', 'on_selected', 'on_invited', 'on_confirmed', 'reminder']),
      template_id: z.string().nullable().optional(),
      enabled: z.boolean().optional(),
      days_before: z.number().int().min(0).max(60).optional(),
    },
  }, wrap('set_automation', async (a) => {
    const c = await getClient();
    const ev = await findEvent(a.event);
    const { data: cur } = await c.from('automations').select('*').eq('event_id', ev.id).eq('trigger', a.trigger).maybeSingle();
    const next = {
      event_id: ev.id, trigger: a.trigger, channel: 'email',
      template_id: a.template_id !== undefined ? a.template_id : cur?.template_id ?? null,
      enabled: a.enabled ?? cur?.enabled ?? false,
      days_before: a.days_before ?? cur?.days_before ?? 1,
    };
    const { data, error } = await c.from('automations').upsert(next, { onConflict: 'event_id,trigger' }).select('trigger, template_id, enabled, days_before').single();
    if (error) throw new McpError(error.message);
    return data;
  }));

  server.registerTool('send_template', {
    title: 'Enviar correo',
    description: 'Manda una plantilla a registros concretos (máximo 200 por llamada). Requiere confirm: true. Con test_to manda una sola prueba a esa dirección.',
    inputSchema: {
      event: z.string(), template_id: z.string(),
      registration_ids: z.array(z.string()).max(200).default([]),
      test_to: z.string().email().optional(),
      confirm: z.boolean().optional(),
    },
  }, wrap('send_template', async (a) => {
    if (!a.test_to && !a.confirm) throw new McpError('Enviar correos reales requiere confirm: true (o usa test_to para una prueba).');
    if (!a.test_to && a.registration_ids.length === 0) throw new McpError('No hay registros.');
    const c = await getClient();
    const ev = await findEvent(a.event);
    const { data, error } = await c.functions.invoke('send-messages', { body: { event_id: ev.id, template_id: a.template_id, registration_ids: a.registration_ids, test_to: a.test_to } });
    if (error) throw new McpError(error.message);
    if (!data?.ok) throw new McpError(data?.message ?? 'No se pudo enviar');
    return data;
  }));

  server.registerTool('list_messages', {
    title: 'Historial de mensajes',
    description: 'Mensajes enviados de un evento con su estado (sent, delivered, opened, bounced, failed, exported).',
    inputSchema: { event: z.string(), status: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) },
  }, wrap('list_messages', async (a) => {
    const c = await getClient();
    const ev = await findEvent(a.event);
    let q = c.from('messages').select('id, registration_id, channel, trigger, to_address, subject, status, error, created_at').eq('event_id', ev.id).order('created_at', { ascending: false }).limit(a.limit);
    if (a.status) q = q.eq('status', a.status);
    const { data, error } = await q;
    if (error) throw new McpError(error.message);
    const summary: Record<string, number> = {};
    for (const m of data ?? []) summary[m.status] = (summary[m.status] ?? 0) + 1;
    return { summary, messages: data ?? [] };
  }));

  // ─── Asistencia ──────────────────────────────────────────
  server.registerTool('get_attendance', {
    title: 'Asistencia',
    description: 'Quién ha entrado al evento (check-ins del scanner), totales y llegadas por hora.',
    inputSchema: { event: z.string(), limit: z.number().int().min(1).max(500).default(100) },
  }, wrap('get_attendance', async (a) => {
    const c = await getClient();
    const ev = await findEvent(a.event);
    const [{ data: regs }, { data: cis }] = await Promise.all([
      c.from('registrations').select('id, name, party_size, status').eq('event_id', ev.id).neq('status', 'cancelled'),
      c.from('check_ins').select('registration_id, count, method, scanned_at').eq('event_id', ev.id).order('scanned_at', { ascending: false }),
    ]);
    const names = new Map((regs ?? []).map(r => [r.id, r.name]));
    const byHour: Record<string, number> = {};
    for (const ci of cis ?? []) { const h = new Date(ci.scanned_at).toISOString().slice(0, 13) + ':00Z'; byHour[h] = (byHour[h] ?? 0) + ci.count; }
    return {
      expected_people: (regs ?? []).reduce((s, r) => s + (r.party_size ?? 1), 0),
      entered_people: (cis ?? []).reduce((s, x) => s + x.count, 0),
      entered_registrations: new Set((cis ?? []).map(x => x.registration_id)).size,
      registrations: (regs ?? []).length,
      by_hour_utc: byHour,
      recent: (cis ?? []).slice(0, a.limit).map(x => ({ name: names.get(x.registration_id) ?? '—', count: x.count, method: x.method, at: x.scanned_at })),
    };
  }));
}
