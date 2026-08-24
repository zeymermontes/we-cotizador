-- ─────────────────────────────────────────────────────────────
-- Rotulado: la carpeta de salida ya no se pega como URL.
-- El admin escribe un nombre y la creamos nosotros bajo la carpeta
-- raíz de Drive, validando que no exista otra igual.
--
-- output_folder_id / _url quedan vacíos hasta la primera generación:
-- así un borrador abandonado no deja carpetas huérfanas en Drive.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE labeling_jobs ADD COLUMN IF NOT EXISTS output_folder_name TEXT;
ALTER TABLE labeling_jobs ALTER COLUMN output_folder_id DROP NOT NULL;
