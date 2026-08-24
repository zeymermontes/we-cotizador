import { supabase } from './supabase';
import type { DryRunResult, FunctionError, InspectResult } from './labeling-types';

/**
 * `functions.invoke` esconde el body de la respuesta cuando el status es >= 400
 * (queda en `error.context`, no en `error.message`). Las funciones del rotulado
 * responden 200 con `ok:false`, pero esto cubre los fallos de infraestructura.
 */
async function readInvokeError(error: unknown): Promise<string> {
  const err = error as { context?: { json?: () => Promise<{ message?: string; error?: string }> }; message?: string };
  try {
    const body = await err?.context?.json?.();
    const detail = body?.message ?? body?.error;
    if (detail) return detail;
  } catch {
    /* el body no era JSON */
  }
  return err?.message ?? 'Error de red al invocar la función.';
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T | FunctionError> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) return { ok: false, code: 'NETWORK', message: await readInvokeError(error) };
  return data as T | FunctionError;
}

export function inspect(input: {
  event_folder_url: string;
  sheet_title?: string | null;
  header_row?: number;
}) {
  return call<InspectResult>('labeling-inspect', input);
}

export function dryRun(jobId: string, limit = 3) {
  return call<DryRunResult>('labeling-run-batch', {
    job_id: jobId,
    run_token: crypto.randomUUID(),
    dry_run: true,
    dry_run_limit: limit,
  });
}

/** `reset: true` arranca una generación desde cero: carpeta nueva y URLs en blanco. */
export function startBatch(jobId: string, runToken: string, reset = false) {
  return call<{ ok: true; status: string; has_more: boolean }>('labeling-run-batch', {
    job_id: jobId,
    run_token: runToken,
    reset,
  });
}
