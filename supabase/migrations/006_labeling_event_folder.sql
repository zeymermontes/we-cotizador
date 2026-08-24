-- ─────────────────────────────────────────────────────────────
-- Rotulado: una sola entrada, la carpeta del evento.
--
-- Dentro de esa carpeta se descubren solos el Sheet de invitados y la
-- presentación que hace de plantilla (sin importar cómo se llamen), y
-- ahí mismo se crea la subcarpeta con las invitaciones rotuladas.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE labeling_jobs ADD COLUMN IF NOT EXISTS event_folder_id  TEXT;
ALTER TABLE labeling_jobs ADD COLUMN IF NOT EXISTS event_folder_url TEXT;

-- Se descubren en la carpeta, ya no los escribe el admin
ALTER TABLE labeling_jobs ALTER COLUMN spreadsheet_id DROP NOT NULL;
ALTER TABLE labeling_jobs ALTER COLUMN template_id    DROP NOT NULL;
