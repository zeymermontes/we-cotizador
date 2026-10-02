-- Espejo en Drive de las invitaciones genéricas: carpeta por evento y
-- archivo por registro. La URL que viaja al bot y al correo sigue siendo la
-- del bucket (invitation_url); estas columnas solo guardan la copia.
ALTER TABLE events ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS drive_folder_url TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS invitation_drive_id TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS invitation_drive_url TEXT;
