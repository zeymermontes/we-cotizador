-- ─── Registro de eventos: vistas guardadas ────────────────────
-- Un filtro + orden + columnas con nombre, por evento, para volver
-- a él con un clic ("Confirmados sin invitación", "Mesa 4", …).

CREATE TABLE IF NOT EXISTS saved_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- { search, match, filters: [...], sort: {key, dir}, columns: [...] }
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_event ON saved_views(event_id, created_at);

DROP TRIGGER IF EXISTS trg_saved_views_updated_at ON saved_views;
CREATE TRIGGER trg_saved_views_updated_at
  BEFORE UPDATE ON saved_views FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_views member or super" ON saved_views;
CREATE POLICY "saved_views member or super" ON saved_views
  FOR ALL USING (is_super() OR is_event_member(event_id))
  WITH CHECK (is_super() OR is_event_member(event_id));
