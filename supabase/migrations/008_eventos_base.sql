-- ─── Registro de eventos: base ────────────────────────────────
-- Introduce roles (super / admin de evento), la tabla de eventos,
-- sus miembros, el bucket de imágenes y endurece las políticas
-- existentes para que un admin de evento NO vea el CRM.
--
-- Antes de esta migración, cualquier usuario autenticado era admin
-- total. Todos los usuarios que ya existen quedan como `super`.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Perfiles y roles ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'event_admin' CHECK (role IN ('super', 'event_admin')),
  full_name  TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE profiles IS
  'Rol de cada usuario. super = equipo We.Page (todo). event_admin = solo sus eventos.';

-- Los usuarios que ya existían eran todos del equipo.
INSERT INTO profiles (id, role, email)
SELECT id, 'super', email FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Cada usuario nuevo nace como admin de evento; el rol super se asigna a mano.
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, role, email, full_name)
  VALUES (
    NEW.id,
    'event_admin',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- updated_at genérico
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─── Eventos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 60),
  name        TEXT NOT NULL,
  description TEXT,

  event_date  TIMESTAMPTZ,
  timezone    TEXT NOT NULL DEFAULT 'America/Mexico_City',
  venue       TEXT,

  -- draft: solo admins. published: el form recibe registros.
  -- closed: el form ya no recibe, el scanner sigue. archived: oculto.
  status      TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'closed', 'archived')),

  -- Idiomas del formulario: '{es}', '{en}' o '{es,en}'.
  languages   TEXT[] NOT NULL DEFAULT '{es}'
    CHECK (languages <@ ARRAY['es', 'en'] AND array_length(languages, 1) >= 1),
  default_language TEXT NOT NULL DEFAULT 'es' CHECK (default_language IN ('es', 'en')),

  -- Cómo entran los admins de este evento.
  login_method TEXT NOT NULL DEFAULT 'magic_link'
    CHECK (login_method IN ('magic_link', 'password')),

  capacity               INT CHECK (capacity IS NULL OR capacity > 0),
  registration_closes_at TIMESTAMPTZ,

  -- { logo_url, background_url, primary, background, surface, text,
  --   font_display, font_body, button_radius }
  branding JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Textos de pantallas por idioma:
  -- { welcome: {es:{title,subtitle,button}}, thank_you: {...}, scanner: {...} }
  screens  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- PIN del scanner (bcrypt). Nunca se expone; ver set_event_scanner_pin.
  scanner_pin_hash TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE events IS 'Un evento con registro público, invitaciones y control de acceso.';

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Miembros de evento ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_members (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_members_user ON event_members(user_id);

-- ─── Helpers de autorización ──────────────────────────────────
-- Van DESPUÉS de las tablas: una función en SQL puro se valida al
-- crearse y necesita que profiles y event_members ya existan.
-- SECURITY DEFINER para que las políticas las consulten sin caer
-- en recursión de RLS.
CREATE OR REPLACE FUNCTION is_super()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super'
  );
$$;

CREATE OR REPLACE FUNCTION is_event_member(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_members
    WHERE event_id = p_event_id AND user_id = auth.uid()
  );
$$;

-- Vista para el admin: miembros con su correo, sin exponer auth.users.
CREATE OR REPLACE VIEW event_members_view AS
  SELECT m.event_id, m.user_id, m.role, m.created_at,
         p.email, p.full_name, p.role AS profile_role
  FROM event_members m
  JOIN profiles p ON p.id = m.user_id;

-- ─── Vista pública (form y scanner) ───────────────────────────
-- Solo eventos publicados/cerrados y solo columnas inofensivas.
-- La vista corre con permisos del dueño (postgres), por eso filtra ella misma.
CREATE OR REPLACE VIEW events_public AS
  SELECT id, slug, name, description, event_date, timezone, venue, status,
         languages, default_language, registration_closes_at, branding, screens
  FROM events
  WHERE status IN ('published', 'closed');

GRANT SELECT ON events_public TO anon, authenticated;
GRANT SELECT ON event_members_view TO authenticated;

-- ─── PIN del scanner ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_event_scanner_pin(p_event_id UUID, p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_super() OR is_event_member(p_event_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'El PIN debe tener entre 4 y 8 dígitos';
  END IF;
  UPDATE events
  SET scanner_pin_hash = crypt(p_pin, gen_salt('bf', 10))
  WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION verify_event_scanner_pin(p_slug TEXT, p_pin TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM events
  WHERE slug = p_slug
    AND status IN ('published', 'closed')
    AND scanner_pin_hash IS NOT NULL
    AND scanner_pin_hash = crypt(p_pin, scanner_pin_hash);
  RETURN v_id; -- NULL si no coincide
END;
$$;

-- Solo el servidor (edge functions) verifica PINs; así no se puede
-- adivinar por fuerza bruta desde el navegador.
REVOKE EXECUTE ON FUNCTION verify_event_scanner_pin(TEXT, TEXT) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION verify_event_scanner_pin(TEXT, TEXT) TO service_role;
GRANT  EXECUTE ON FUNCTION set_event_scanner_pin(UUID, TEXT) TO authenticated;

-- Para que la edge function de invitaciones encuentre usuarios por correo.
CREATE OR REPLACE FUNCTION get_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION get_user_id_by_email(TEXT) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION get_user_id_by_email(TEXT) TO service_role;

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_members ENABLE ROW LEVEL SECURITY;

-- profiles: cada quien ve el suyo; super ve y edita todos.
DROP POLICY IF EXISTS "profiles select own or super" ON profiles;
CREATE POLICY "profiles select own or super" ON profiles
  FOR SELECT USING (id = auth.uid() OR is_super());

DROP POLICY IF EXISTS "profiles update super" ON profiles;
CREATE POLICY "profiles update super" ON profiles
  FOR UPDATE USING (is_super());

-- events
DROP POLICY IF EXISTS "events select member or super" ON events;
CREATE POLICY "events select member or super" ON events
  FOR SELECT USING (is_super() OR is_event_member(id));

DROP POLICY IF EXISTS "events insert super" ON events;
CREATE POLICY "events insert super" ON events
  FOR INSERT WITH CHECK (is_super());

DROP POLICY IF EXISTS "events update member or super" ON events;
CREATE POLICY "events update member or super" ON events
  FOR UPDATE USING (is_super() OR is_event_member(id));

DROP POLICY IF EXISTS "events delete super" ON events;
CREATE POLICY "events delete super" ON events
  FOR DELETE USING (is_super());

-- event_members: los miembros ven quién más está; solo super agrega o quita.
DROP POLICY IF EXISTS "members select member or super" ON event_members;
CREATE POLICY "members select member or super" ON event_members
  FOR SELECT USING (is_super() OR is_event_member(event_id));

DROP POLICY IF EXISTS "members write super" ON event_members;
CREATE POLICY "members write super" ON event_members
  FOR ALL USING (is_super()) WITH CHECK (is_super());

-- ─── Endurecer el CRM: solo super ─────────────────────────────
-- Antes: auth.role() = 'authenticated'. Un admin de evento también
-- está autenticado, así que sin esto vería cotizaciones y pagos.
DROP POLICY IF EXISTS "Admin full access clients" ON clients;
CREATE POLICY "Admin full access clients" ON clients
  FOR ALL USING (is_super()) WITH CHECK (is_super());

DROP POLICY IF EXISTS "Admin full access quotations" ON quotations;
CREATE POLICY "Admin full access quotations" ON quotations
  FOR ALL USING (is_super()) WITH CHECK (is_super());

DROP POLICY IF EXISTS "Admin full access payments" ON payments;
CREATE POLICY "Admin full access payments" ON payments
  FOR ALL USING (is_super()) WITH CHECK (is_super());

DROP POLICY IF EXISTS "Admin full access documents" ON documents;
CREATE POLICY "Admin full access documents" ON documents
  FOR ALL USING (is_super()) WITH CHECK (is_super());

DROP POLICY IF EXISTS "Admin full access labeling_jobs" ON labeling_jobs;
CREATE POLICY "Admin full access labeling_jobs" ON labeling_jobs
  FOR ALL USING (is_super()) WITH CHECK (is_super());

-- Las políticas de INSERT público del cotizador se quedan igual:
-- "Allow public inserts on clients" / "Allow public inserts on quotations".

-- ─── Storage: imágenes de eventos ─────────────────────────────
-- Bucket público de lectura. Ruta: <event_id>/<carpeta>/<archivo>.webp
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-assets', 'event-assets', true, 3145728,
  ARRAY['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "event-assets public read" ON storage.objects;
CREATE POLICY "event-assets public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'event-assets');

DROP POLICY IF EXISTS "event-assets write member or super" ON storage.objects;
CREATE POLICY "event-assets write member or super" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'event-assets'
    AND (is_super() OR is_event_member(((storage.foldername(name))[1])::uuid))
  );

DROP POLICY IF EXISTS "event-assets update member or super" ON storage.objects;
CREATE POLICY "event-assets update member or super" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'event-assets'
    AND (is_super() OR is_event_member(((storage.foldername(name))[1])::uuid))
  );

DROP POLICY IF EXISTS "event-assets delete member or super" ON storage.objects;
CREATE POLICY "event-assets delete member or super" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'event-assets'
    AND (is_super() OR is_event_member(((storage.foldername(name))[1])::uuid))
  );
