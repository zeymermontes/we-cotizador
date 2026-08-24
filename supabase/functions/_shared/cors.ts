export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Todas las respuestas de negocio salen con HTTP 200 y `ok:false`.
 * Motivo: `supabase.functions.invoke` con status >= 400 devuelve un
 * FunctionsHttpError cuyo body NO está en `error.message`, y el front
 * termina mostrando "Error desconocido".
 */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

export const fail = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  json({ ok: false, code, message, ...extra });
