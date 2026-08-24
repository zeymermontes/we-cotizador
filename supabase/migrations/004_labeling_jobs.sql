-- ─────────────────────────────────────────────────────────────
-- We.Page — Rotulado de invitaciones digitales
-- Genera 1 PDF por invitado a partir de una plantilla de Google
-- Slides, lo guarda en Drive y escribe la URL de vuelta en el Sheet.
--
-- La hoja de cálculo es la ÚNICA fuente de verdad del estado por
-- invitado (celda de URL vacía = pendiente). Esta tabla solo guarda
-- configuración, contadores y errores para la UI del admin.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS labeling_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vínculo opcional al CRM existente
  quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,

  name TEXT NOT NULL,

  -- ── Los 4 datos que pide la UI ──
  spreadsheet_id    TEXT NOT NULL,
  spreadsheet_url   TEXT,
  sheet_title       TEXT,
  header_row        INT  NOT NULL DEFAULT 1,
  output_folder_id  TEXT NOT NULL,
  output_folder_url TEXT,
  template_id       TEXT NOT NULL,
  template_url      TEXT,
  typeform_url      TEXT,

  -- ── Mapeo descubierto en runtime ──
  -- { "{{nombre}}": {"source":"column","column":"Nombre"},
  --   "{{link}}":   {"source":"typeform"},
  --   "{{mesa}}":   {"source":"literal","value":"1"} }
  placeholder_map JSONB NOT NULL DEFAULT '{}'::jsonb,

  file_name_template TEXT NOT NULL DEFAULT '{{nombre}}',
  name_column        TEXT,            -- columna que define "fila con datos"
  pdf_url_column     TEXT NOT NULL DEFAULT 'PDF URL',

  -- ── Ejecución ──
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','running','paused','completed','failed')),
  total_rows     INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,
  failed_rows    INT NOT NULL DEFAULT 0,
  last_error TEXT,
  -- [{ "row": 15, "name": "Ana", "message": "...", "retryable": true }]
  row_errors JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ── Housekeeping ──
  tmp_folder_id     TEXT,            -- subcarpeta "_tmp" de copias de Slides
  keep_slide_copies BOOLEAN NOT NULL DEFAULT false,
  concurrency       INT NOT NULL DEFAULT 3 CHECK (concurrency BETWEEN 1 AND 6),

  -- ── Lock cooperativo (evita doble ejecución) ──
  lock_token UUID,
  locked_at  TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE labeling_jobs IS
  'Rotulado masivo: 1 PDF por invitado desde plantilla de Slides. El Sheet es la fuente de verdad del estado por fila.';

CREATE INDEX IF NOT EXISTS idx_labeling_jobs_status     ON labeling_jobs(status);
CREATE INDEX IF NOT EXISTS idx_labeling_jobs_created_at ON labeling_jobs(created_at DESC);

-- ─── Row Level Security ──────────────────────────────────────
-- Sin política de INSERT público: esto es exclusivamente admin.
ALTER TABLE labeling_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access labeling_jobs" ON labeling_jobs
  FOR ALL USING (auth.role() = 'authenticated');

-- ─── Trigger updated_at ──────────────────────────────────────
CREATE TRIGGER update_labeling_jobs_updated_at BEFORE UPDATE ON labeling_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
