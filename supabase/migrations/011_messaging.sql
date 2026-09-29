-- ─── Registro de eventos: comunicaciones ──────────────────────
-- Plantillas de correo por evento, bitácora de mensajes (con el
-- estado que reporta Resend) y automatizaciones por disparador.
-- WhatsApp se envía con el bot a partir del Excel (fase 5); aquí solo
-- queda registrado como "exportado".

-- ─── Remitente por evento ─────────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS reply_to    TEXT;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- ─── Plantillas ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp')),
  name       TEXT NOT NULL,
  -- Por idioma: {"es": "...", "en": "..."}. Variables {{nombre}}, {{evento}}, {{q:<id>}}…
  subject    JSONB NOT NULL DEFAULT '{}'::jsonb,
  body       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_templates_event ON message_templates(event_id);
DROP TRIGGER IF EXISTS trg_message_templates_updated_at ON message_templates;
CREATE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Bitácora ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  template_id     UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  trigger         TEXT,                       -- manual | on_register | on_invited | reminder | test | export
  to_address      TEXT,
  subject         TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'opened', 'bounced', 'failed', 'exported')),
  provider_id     TEXT,                       -- id del correo en Resend
  error           TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_event        ON messages(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_registration ON messages(registration_id);
CREATE INDEX IF NOT EXISTS idx_messages_provider     ON messages(provider_id);
DROP TRIGGER IF EXISTS trg_messages_updated_at ON messages;
CREATE TRIGGER trg_messages_updated_at
  BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

-- ─── Automatizaciones ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  trigger     TEXT NOT NULL
    CHECK (trigger IN ('on_register', 'on_waitlist', 'on_selected', 'on_invited', 'on_confirmed', 'reminder')),
  channel     TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  days_before INT NOT NULL DEFAULT 1 CHECK (days_before BETWEEN 0 AND 60),   -- solo reminder
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, trigger)
);
DROP TRIGGER IF EXISTS trg_automations_updated_at ON automations;
CREATE TRIGGER trg_automations_updated_at
  BEFORE UPDATE ON automations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "templates member or super" ON message_templates;
CREATE POLICY "templates member or super" ON message_templates
  FOR ALL USING (is_super() OR is_event_member(event_id))
  WITH CHECK (is_super() OR is_event_member(event_id));

-- Los envíos reales los inserta el servidor; el cliente solo registra
-- exportaciones (Excel para WhatsApp) y consulta.
DROP POLICY IF EXISTS "messages member or super" ON messages;
CREATE POLICY "messages member or super" ON messages
  FOR ALL USING (is_super() OR is_event_member(event_id))
  WITH CHECK (is_super() OR is_event_member(event_id));

DROP POLICY IF EXISTS "automations member or super" ON automations;
CREATE POLICY "automations member or super" ON automations
  FOR ALL USING (is_super() OR is_event_member(event_id))
  WITH CHECK (is_super() OR is_event_member(event_id));

-- ─── Disparador por cambio de estatus ─────────────────────────
-- Cuando un registro pasa a seleccionado/invitado/confirmado, avisa
-- a la edge function run-automations (por pg_net, fuera de la
-- transacción). Usa el secreto 'labeling_cron_key' del Vault (la anon
-- key) para pasar el gateway, igual que el watchdog del rotulado.
CREATE OR REPLACE FUNCTION notify_registration_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('selected', 'invited', 'confirmed', 'waitlist') THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'labeling_cron_key' LIMIT 1;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'functions_base_url' LIMIT 1;
  IF v_key IS NULL OR v_url IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := v_url || '/run-automations',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('type', 'status', 'registration_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_status_automation ON registrations;
CREATE TRIGGER trg_registration_status_automation
  AFTER UPDATE OF status ON registrations
  FOR EACH ROW EXECUTE FUNCTION notify_registration_status();

-- ─── Recordatorios: cada hora ─────────────────────────────────
-- Requiere en Vault: 'labeling_cron_key' (anon key) y
-- 'functions_base_url' (https://<ref>.supabase.co/functions/v1).
CREATE OR REPLACE FUNCTION run_event_reminders()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'labeling_cron_key' LIMIT 1;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'functions_base_url' LIMIT 1;
  IF v_key IS NULL OR v_url IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/run-automations',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('type', 'reminders')
  );
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('event-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('event-reminders', '0 * * * *', 'SELECT run_event_reminders()');
