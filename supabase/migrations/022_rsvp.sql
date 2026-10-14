-- ─────────────────────────────────────────────────────────────
-- Lista VIP con confirmación por enlace.
-- Un VIP es un registro creado por el equipo (source.ref = 'vip') con un
-- rsvp_token: su enlace personal registro.we.page/<slug>/c/<token> muestra
-- la portada del evento y dos botones (asistiré / no asistiré).
-- Al responder, la función `rsvp` pone status confirmed/cancelled; los
-- automatismos de Comunicaciones (on_invited, on_confirmed) hacen el resto.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS rsvp_token    TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS rsvp_response TEXT CHECK (rsvp_response IN ('yes', 'no'));
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS rsvp_at       TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_rsvp_token ON registrations(rsvp_token) WHERE rsvp_token IS NOT NULL;

-- { question: {es,en}, yes_label: {es,en}, no_label: {es,en},
--   message_yes: {es,en}, message_no: {es,en}, auto_invitation: bool }
ALTER TABLE events ADD COLUMN IF NOT EXISTS rsvp_config JSONB;
