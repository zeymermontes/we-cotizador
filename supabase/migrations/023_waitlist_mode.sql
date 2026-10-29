-- Modo lista de espera manual: con waitlist_mode todos los registros nuevos
-- entran como 'waitlist' y la bienvenida muestra un aviso configurable
-- (screens.welcome.waitlist). Independiente del cupo automático.
ALTER TABLE events ADD COLUMN IF NOT EXISTS waitlist_mode BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW events_public AS
  SELECT id, slug, name, description, event_date, timezone, venue, status,
         languages, default_language, registration_closes_at, branding, screens, waitlist_mode
  FROM events
  WHERE status IN ('published', 'closed');
GRANT SELECT ON events_public TO anon, authenticated;
