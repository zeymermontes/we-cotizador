-- ─────────────────────────────────────────────────────────────
-- Rotulado: watchdog en la base de datos.
--
-- Cada invocación de labeling-run-batch encadena la siguiente, pero esa
-- cadena se corta si el worker muere (WORKER_RESOURCE_LIMIT) o si Deno
-- cancela el fetch al devolver la respuesta. Hasta ahora quien lo
-- revivía era el navegador, así que cerrar la pestaña dejaba el trabajo
-- parado. Este cron lo revive desde el servidor.
--
-- Requiere el secreto 'labeling_cron_key' en Vault (la anon key del
-- proyecto). Se crea aparte, fuera de git.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.labeling_watchdog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  job    RECORD;
  key    TEXT;
  fn_url TEXT;
BEGIN
  SELECT decrypted_secret INTO key
  FROM vault.decrypted_secrets
  WHERE name = 'labeling_cron_key';

  SELECT decrypted_secret INTO fn_url
  FROM vault.decrypted_secrets
  WHERE name = 'labeling_functions_url';

  IF key IS NULL OR fn_url IS NULL THEN
    RAISE WARNING 'labeling_watchdog: faltan los secretos en Vault';
    RETURN;
  END IF;

  -- Un job vivo actualiza updated_at cada pocos segundos (progreso por
  -- chunk). Dos minutos sin moverse = la cadena se rompió. El umbral va
  -- por encima del TTL del lock para que el reintento pueda tomarlo.
  FOR job IN
    SELECT id
    FROM labeling_jobs
    WHERE status = 'running'
      AND updated_at < now() - interval '2 minutes'
    LIMIT 5
  LOOP
    PERFORM net.http_post(
      url     := fn_url || '/labeling-run-batch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || key
      ),
      body    := jsonb_build_object(
        'job_id',      job.id,
        'run_token',   gen_random_uuid(),
        'chain_depth', 0
      ),
      timeout_milliseconds := 5000
    );

    RAISE NOTICE 'labeling_watchdog: relanzado %', job.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.labeling_watchdog() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'labeling-watchdog',
  '* * * * *',
  $$SELECT public.labeling_watchdog()$$
);
