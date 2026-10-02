-- ─────────────────────────────────────────────────────────────
-- Invitaciones: vigilante en la base de datos (mismo patrón que el
-- rotulado, 007). invitations-run-batch encadena el siguiente lote por
-- sí misma; si el worker muere o la cadena se corta, este cron relanza
-- las corridas que llevan más de 2 minutos sin moverse.
--
-- Secretos en Vault (se crean fuera de git):
--   labeling_cron_key        anon key del proyecto (ya existe)
--   labeling_functions_url   base de las funciones (ya existe)
--   invitations_cron_secret  mismo valor que el secreto JOBS_CRON_SECRET
--                            de las funciones
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invitations_watchdog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  job    RECORD;
  key    TEXT;
  fn_url TEXT;
  secret TEXT;
BEGIN
  SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'labeling_cron_key';
  SELECT decrypted_secret INTO fn_url FROM vault.decrypted_secrets WHERE name = 'labeling_functions_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'invitations_cron_secret';
  IF key IS NULL OR fn_url IS NULL OR secret IS NULL THEN
    RAISE WARNING 'invitations_watchdog: faltan los secretos en Vault';
    RETURN;
  END IF;

  -- Un lote vivo actualiza la corrida al terminar (menos de 2 min). Una
  -- corrida 'ready' que nadie arrancó también cuenta.
  FOR job IN
    SELECT id
    FROM invitation_jobs
    WHERE status IN ('running', 'ready')
      AND updated_at < now() - interval '2 minutes'
    ORDER BY updated_at
    LIMIT 3
  LOOP
    PERFORM net.http_post(
      url     := fn_url || '/invitations-run-batch',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
      body    := jsonb_build_object('job_id', job.id, 'cron_secret', secret, 'chain_depth', 0),
      timeout_milliseconds := 5000
    );
    RAISE NOTICE 'invitations_watchdog: relanzado %', job.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.invitations_watchdog() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('invitations-watchdog') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invitations-watchdog');
SELECT cron.schedule('invitations-watchdog', '* * * * *', $$SELECT public.invitations_watchdog()$$);
