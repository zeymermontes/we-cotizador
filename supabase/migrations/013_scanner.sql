-- ─── Registro de eventos: scanner de acceso ───────────────────
-- El staff entra a acceso.we.page/<slug> con el PIN del evento, la
-- edge function scanner-session le da un token temporal y con él
-- escanea QRs (scanner-checkin). Nada de esto toca RLS desde el
-- navegador: todo pasa por las funciones con service role.

CREATE TABLE IF NOT EXISTS scanner_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  device_label TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scans        INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scanner_sessions_event ON scanner_sessions(event_id, last_seen_at DESC);

-- Intentos de PIN por IP, para frenar fuerza bruta.
CREATE TABLE IF NOT EXISTS scanner_pin_attempts (
  id           BIGSERIAL PRIMARY KEY,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ip           TEXT NOT NULL,
  ok           BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pin_attempts_event_ip ON scanner_pin_attempts(event_id, ip, attempted_at DESC);

CREATE TABLE IF NOT EXISTS check_ins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES scanner_sessions(id) ON DELETE SET NULL,
  -- Cuántas personas entraron con este escaneo (un registro puede ser un grupo)
  count           INT NOT NULL DEFAULT 1 CHECK (count >= 1),
  method          TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr', 'manual', 'admin')),
  prev_status     TEXT,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_check_ins_event ON check_ins(event_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_ins_registration ON check_ins(registration_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'check_ins'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE check_ins;
  END IF;
END $$;

-- ─── RLS: el admin consulta; el scanner escribe vía service role ──
ALTER TABLE scanner_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scanner_pin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions select member or super" ON scanner_sessions;
CREATE POLICY "sessions select member or super" ON scanner_sessions
  FOR SELECT USING (is_super() OR is_event_member(event_id));
DROP POLICY IF EXISTS "sessions delete member or super" ON scanner_sessions;
CREATE POLICY "sessions delete member or super" ON scanner_sessions
  FOR DELETE USING (is_super() OR is_event_member(event_id));

DROP POLICY IF EXISTS "check_ins member or super" ON check_ins;
CREATE POLICY "check_ins member or super" ON check_ins
  FOR ALL USING (is_super() OR is_event_member(event_id))
  WITH CHECK (is_super() OR is_event_member(event_id));
