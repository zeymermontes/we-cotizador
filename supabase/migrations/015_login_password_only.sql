-- Los administradores entran siempre con correo y contraseña. El enlace
-- mágico se retiró: dependía del correo de Supabase Auth y era de un solo
-- uso, lo que confundía al equipo. Se conserva la columna por compatibilidad.
UPDATE events SET login_method = 'password' WHERE login_method <> 'password';
ALTER TABLE events ALTER COLUMN login_method SET DEFAULT 'password';
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_login_method_check;
ALTER TABLE events ADD CONSTRAINT events_login_method_check CHECK (login_method = 'password');
