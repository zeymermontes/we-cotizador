-- ─── Registro de eventos: formularios y registros ─────────────
-- El formulario de cada evento vive como JSON (ver
-- supabase/functions/_shared/form-engine.ts). El admin edita un
-- borrador; al publicar se congela una versión numerada y cada
-- registro guarda con qué versión se llenó, así editar después no
-- rompe los reportes.

-- ─── Borrador ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_forms (
  event_id          UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  draft             JSONB NOT NULL DEFAULT '{"v":1,"questions":[],"settings":{}}'::jsonb,
  published_version INT,
  updated_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_event_forms_updated_at ON event_forms;
CREATE TRIGGER trg_event_forms_updated_at
  BEFORE UPDATE ON event_forms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Versiones publicadas ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS form_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version      INT  NOT NULL,
  schema       JSONB NOT NULL,
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, version)
);

-- Publicar = copiar el borrador a una versión nueva. Atómico y con
-- permisos verificados aquí, no en el cliente.
CREATE OR REPLACE FUNCTION publish_event_form(p_event_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_draft JSONB;
  v_next  INT;
BEGIN
  IF NOT (is_super() OR is_event_member(p_event_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT draft INTO v_draft FROM event_forms WHERE event_id = p_event_id;
  IF v_draft IS NULL THEN
    RAISE EXCEPTION 'El formulario no existe';
  END IF;
  IF jsonb_array_length(COALESCE(v_draft->'questions', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'El formulario no tiene preguntas';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next FROM form_versions WHERE event_id = p_event_id;

  INSERT INTO form_versions (event_id, version, schema, published_by)
  VALUES (p_event_id, v_next, v_draft, auth.uid());

  UPDATE event_forms SET published_version = v_next WHERE event_id = p_event_id;
  RETURN v_next;
END;
$$;
GRANT EXECUTE ON FUNCTION publish_event_form(UUID) TO authenticated;

-- ─── Vista pública: la versión publicada de un evento publicado ──
CREATE OR REPLACE VIEW event_forms_public AS
  SELECT e.slug, e.id AS event_id, v.version, v.schema
  FROM events e
  JOIN event_forms f ON f.event_id = e.id
  JOIN form_versions v ON v.event_id = e.id AND v.version = f.published_version
  WHERE e.status = 'published';

GRANT SELECT ON event_forms_public TO anon, authenticated;

-- ─── Registros ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS registrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  form_version  INT,

  -- Idempotencia: el navegador genera el id y lo reintenta si falla la red.
  submission_id UUID UNIQUE,

  -- Respuestas por id de pregunta (no por texto): renombrar no rompe nada.
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  lang    TEXT NOT NULL DEFAULT 'es',

  -- Columnas promovidas desde las preguntas marcadas como identidad.
  name       TEXT,
  email      TEXT,
  phone      TEXT,
  party_size INT NOT NULL DEFAULT 1 CHECK (party_size >= 1),
  company    TEXT,

  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'waitlist', 'selected', 'invited', 'confirmed', 'checked_in', 'cancelled')),
  tags  TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,

  -- utm_*, ref, user agent, etc.
  source JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Fase 5: token del QR e invitación generada.
  qr_token       TEXT UNIQUE,
  invitation_url TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registrations_event      ON registrations(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_event_email ON registrations(event_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_registrations_event_phone ON registrations(event_id, phone);
CREATE INDEX IF NOT EXISTS idx_registrations_status     ON registrations(event_id, status);

DROP TRIGGER IF EXISTS trg_registrations_updated_at ON registrations;
CREATE TRIGGER trg_registrations_updated_at
  BEFORE UPDATE ON registrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tabla en vivo para el panel de registros.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'registrations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE registrations;
  END IF;
END $$;

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE event_forms   ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_forms member or super" ON event_forms;
CREATE POLICY "event_forms member or super" ON event_forms
  FOR ALL USING (is_super() OR is_event_member(event_id))
  WITH CHECK (is_super() OR is_event_member(event_id));

DROP POLICY IF EXISTS "form_versions select member or super" ON form_versions;
CREATE POLICY "form_versions select member or super" ON form_versions
  FOR SELECT USING (is_super() OR is_event_member(event_id));

-- El público NO inserta directo: pasa por la edge function
-- submit-registration (service role), que valida contra el esquema.
DROP POLICY IF EXISTS "registrations member or super" ON registrations;
CREATE POLICY "registrations member or super" ON registrations
  FOR ALL USING (is_super() OR is_event_member(event_id))
  WITH CHECK (is_super() OR is_event_member(event_id));
