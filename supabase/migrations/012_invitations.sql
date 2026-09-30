-- ─── Registro de eventos: QR e invitaciones (solo super) ──────
-- Cada registro puede tener un QR único (imagen en Storage) y un PDF
-- de invitación generado desde una plantilla de Google Slides,
-- reutilizando el pipeline del rotulado. El Excel para el bot de
-- WhatsApp se arma en el navegador.

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS qr_url TEXT;

-- Configuración de la plantilla de invitación, una por evento:
-- { event_folder_id, event_folder_url, template_id, template_url, template_name,
--   output_folder_name, placeholder_map, file_name_template, placeholders, qr_shapes }
ALTER TABLE events ADD COLUMN IF NOT EXISTS invitation_config JSONB;

CREATE TABLE IF NOT EXISTS invitation_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  -- Copia de events.invitation_config al momento de crear la corrida
  config           JSONB NOT NULL,
  registration_ids UUID[] NOT NULL DEFAULT '{}',
  force            BOOLEAN NOT NULL DEFAULT false,    -- regenerar aunque ya tengan PDF

  output_folder_id  TEXT,
  output_folder_url TEXT,
  tmp_folder_id     TEXT,

  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'running', 'paused', 'completed', 'failed')),
  total_rows     INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,
  failed_rows    INT NOT NULL DEFAULT 0,
  last_error     TEXT,
  -- [{ "registration_id": "...", "name": "Ana", "message": "...", "retryable": true }]
  row_errors     JSONB NOT NULL DEFAULT '[]'::jsonb,

  lock_token UUID,
  locked_at  TIMESTAMPTZ,

  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invitation_jobs_event ON invitation_jobs(event_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_invitation_jobs_updated_at ON invitation_jobs;
CREATE TRIGGER trg_invitation_jobs_updated_at
  BEFORE UPDATE ON invitation_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE invitation_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invitation_jobs super" ON invitation_jobs;
CREATE POLICY "invitation_jobs super" ON invitation_jobs
  FOR ALL USING (is_super()) WITH CHECK (is_super());
