-- Las plantillas pueden adjuntar la invitación y/o el QR del registro como
-- archivo (Resend los toma desde la URL guardada), además del enlace.
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS attach_invitation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS attach_qr BOOLEAN NOT NULL DEFAULT false;
