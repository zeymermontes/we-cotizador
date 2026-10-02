-- Permisos por miembro: rol (owner/admin editan, viewer solo lee) y pestañas
-- permitidas (NULL = todas). Hasta ahora is_event_member ignoraba el rol y
-- cualquier miembro podía editar todo. El equipo (profiles.role = super)
-- sigue con acceso total.

ALTER TABLE event_members ADD COLUMN IF NOT EXISTS tabs TEXT[];
COMMENT ON COLUMN event_members.tabs IS 'Pestañas permitidas (resumen, formulario, diseno, registros, comunicaciones, scanner, ajustes). NULL = todas.';

CREATE OR REPLACE FUNCTION member_tab(p_event_id UUID, p_tab TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_super() OR EXISTS (
    SELECT 1 FROM event_members
    WHERE event_id = p_event_id AND user_id = auth.uid()
      AND (tabs IS NULL OR p_tab = ANY(tabs))
  );
$$;

CREATE OR REPLACE FUNCTION member_any_tab(p_event_id UUID, p_tabs TEXT[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_super() OR EXISTS (
    SELECT 1 FROM event_members
    WHERE event_id = p_event_id AND user_id = auth.uid()
      AND (tabs IS NULL OR tabs && p_tabs)
  );
$$;

CREATE OR REPLACE FUNCTION member_can_edit(p_event_id UUID, p_tab TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_super() OR EXISTS (
    SELECT 1 FROM event_members
    WHERE event_id = p_event_id AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND (tabs IS NULL OR p_tab = ANY(tabs))
  );
$$;

-- ─── Formulario ───────────────────────────────────────────────
DROP POLICY IF EXISTS "event_forms member or super" ON event_forms;
DROP POLICY IF EXISTS "event_forms read" ON event_forms;
CREATE POLICY "event_forms read" ON event_forms FOR SELECT USING (member_tab(event_id, 'formulario'));
DROP POLICY IF EXISTS "event_forms insert" ON event_forms;
CREATE POLICY "event_forms insert" ON event_forms FOR INSERT WITH CHECK (member_can_edit(event_id, 'formulario'));
DROP POLICY IF EXISTS "event_forms update" ON event_forms;
CREATE POLICY "event_forms update" ON event_forms FOR UPDATE USING (member_can_edit(event_id, 'formulario')) WITH CHECK (member_can_edit(event_id, 'formulario'));
DROP POLICY IF EXISTS "event_forms delete" ON event_forms;
CREATE POLICY "event_forms delete" ON event_forms FOR DELETE USING (member_can_edit(event_id, 'formulario'));

DROP POLICY IF EXISTS "form_versions select member or super" ON form_versions;
DROP POLICY IF EXISTS "form_versions read" ON form_versions;
CREATE POLICY "form_versions read" ON form_versions FOR SELECT USING (member_tab(event_id, 'formulario'));

CREATE OR REPLACE FUNCTION publish_event_form(p_event_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_draft JSONB;
  v_next  INT;
BEGIN
  IF NOT member_can_edit(p_event_id, 'formulario') THEN
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

-- ─── Registros (los leen también comunicaciones, scanner e invitaciones) ──
DROP POLICY IF EXISTS "registrations member or super" ON registrations;
DROP POLICY IF EXISTS "registrations read" ON registrations;
CREATE POLICY "registrations read" ON registrations FOR SELECT
  USING (member_any_tab(event_id, ARRAY['registros', 'comunicaciones', 'scanner', 'invitaciones']));
DROP POLICY IF EXISTS "registrations insert" ON registrations;
CREATE POLICY "registrations insert" ON registrations FOR INSERT WITH CHECK (member_can_edit(event_id, 'registros'));
DROP POLICY IF EXISTS "registrations update" ON registrations;
CREATE POLICY "registrations update" ON registrations FOR UPDATE USING (member_can_edit(event_id, 'registros')) WITH CHECK (member_can_edit(event_id, 'registros'));
DROP POLICY IF EXISTS "registrations delete" ON registrations;
CREATE POLICY "registrations delete" ON registrations FOR DELETE USING (member_can_edit(event_id, 'registros'));

DROP POLICY IF EXISTS "saved_views member or super" ON saved_views;
DROP POLICY IF EXISTS "saved_views read" ON saved_views;
CREATE POLICY "saved_views read" ON saved_views FOR SELECT USING (member_tab(event_id, 'registros'));
DROP POLICY IF EXISTS "saved_views write" ON saved_views;
CREATE POLICY "saved_views write" ON saved_views FOR INSERT WITH CHECK (member_can_edit(event_id, 'registros'));
DROP POLICY IF EXISTS "saved_views update" ON saved_views;
CREATE POLICY "saved_views update" ON saved_views FOR UPDATE USING (member_can_edit(event_id, 'registros')) WITH CHECK (member_can_edit(event_id, 'registros'));
DROP POLICY IF EXISTS "saved_views delete" ON saved_views;
CREATE POLICY "saved_views delete" ON saved_views FOR DELETE USING (member_can_edit(event_id, 'registros'));

-- ─── Comunicaciones ───────────────────────────────────────────
DROP POLICY IF EXISTS "templates member or super" ON message_templates;
DROP POLICY IF EXISTS "templates read" ON message_templates;
CREATE POLICY "templates read" ON message_templates FOR SELECT USING (member_tab(event_id, 'comunicaciones'));
DROP POLICY IF EXISTS "templates insert" ON message_templates;
CREATE POLICY "templates insert" ON message_templates FOR INSERT WITH CHECK (member_can_edit(event_id, 'comunicaciones'));
DROP POLICY IF EXISTS "templates update" ON message_templates;
CREATE POLICY "templates update" ON message_templates FOR UPDATE USING (member_can_edit(event_id, 'comunicaciones')) WITH CHECK (member_can_edit(event_id, 'comunicaciones'));
DROP POLICY IF EXISTS "templates delete" ON message_templates;
CREATE POLICY "templates delete" ON message_templates FOR DELETE USING (member_can_edit(event_id, 'comunicaciones'));

DROP POLICY IF EXISTS "messages member or super" ON messages;
DROP POLICY IF EXISTS "messages read" ON messages;
CREATE POLICY "messages read" ON messages FOR SELECT USING (member_any_tab(event_id, ARRAY['comunicaciones', 'registros']));
DROP POLICY IF EXISTS "messages insert" ON messages;
CREATE POLICY "messages insert" ON messages FOR INSERT WITH CHECK (member_can_edit(event_id, 'comunicaciones'));
DROP POLICY IF EXISTS "messages update" ON messages;
CREATE POLICY "messages update" ON messages FOR UPDATE USING (member_can_edit(event_id, 'comunicaciones')) WITH CHECK (member_can_edit(event_id, 'comunicaciones'));
DROP POLICY IF EXISTS "messages delete" ON messages;
CREATE POLICY "messages delete" ON messages FOR DELETE USING (member_can_edit(event_id, 'comunicaciones'));

DROP POLICY IF EXISTS "automations member or super" ON automations;
DROP POLICY IF EXISTS "automations read" ON automations;
CREATE POLICY "automations read" ON automations FOR SELECT USING (member_tab(event_id, 'comunicaciones'));
DROP POLICY IF EXISTS "automations insert" ON automations;
CREATE POLICY "automations insert" ON automations FOR INSERT WITH CHECK (member_can_edit(event_id, 'comunicaciones'));
DROP POLICY IF EXISTS "automations update" ON automations;
CREATE POLICY "automations update" ON automations FOR UPDATE USING (member_can_edit(event_id, 'comunicaciones')) WITH CHECK (member_can_edit(event_id, 'comunicaciones'));
DROP POLICY IF EXISTS "automations delete" ON automations;
CREATE POLICY "automations delete" ON automations FOR DELETE USING (member_can_edit(event_id, 'comunicaciones'));

-- ─── Scanner ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "sessions select member or super" ON scanner_sessions;
DROP POLICY IF EXISTS "sessions delete member or super" ON scanner_sessions;
DROP POLICY IF EXISTS "sessions read" ON scanner_sessions;
CREATE POLICY "sessions read" ON scanner_sessions FOR SELECT USING (member_tab(event_id, 'scanner'));
DROP POLICY IF EXISTS "sessions delete" ON scanner_sessions;
CREATE POLICY "sessions delete" ON scanner_sessions FOR DELETE USING (member_can_edit(event_id, 'scanner'));

DROP POLICY IF EXISTS "check_ins member or super" ON check_ins;
DROP POLICY IF EXISTS "check_ins read" ON check_ins;
CREATE POLICY "check_ins read" ON check_ins FOR SELECT USING (member_any_tab(event_id, ARRAY['scanner', 'registros']));
DROP POLICY IF EXISTS "check_ins insert" ON check_ins;
CREATE POLICY "check_ins insert" ON check_ins FOR INSERT WITH CHECK (member_can_edit(event_id, 'scanner'));
DROP POLICY IF EXISTS "check_ins update" ON check_ins;
CREATE POLICY "check_ins update" ON check_ins FOR UPDATE USING (member_can_edit(event_id, 'scanner')) WITH CHECK (member_can_edit(event_id, 'scanner'));
DROP POLICY IF EXISTS "check_ins delete" ON check_ins;
CREATE POLICY "check_ins delete" ON check_ins FOR DELETE USING (member_can_edit(event_id, 'scanner'));

CREATE OR REPLACE FUNCTION set_event_scanner_pin(p_event_id UUID, p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT member_can_edit(p_event_id, 'scanner') THEN
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

-- ─── Evento: diseño vs ajustes vs comunicaciones, por columna ──
-- La política de UPDATE sigue dejando pasar a cualquier miembro; este
-- trigger decide por columnas. Sin auth.uid() (service role) no aplica.
CREATE OR REPLACE FUNCTION events_guard_member_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR is_super() THEN RETURN NEW; END IF;

  IF (NEW.branding IS DISTINCT FROM OLD.branding OR NEW.screens IS DISTINCT FROM OLD.screens)
     AND NOT member_can_edit(OLD.id, 'diseno') THEN
    RAISE EXCEPTION 'Sin permiso para editar el diseño';
  END IF;

  IF (NEW.sender_name IS DISTINCT FROM OLD.sender_name OR NEW.reply_to IS DISTINCT FROM OLD.reply_to)
     AND NOT member_can_edit(OLD.id, 'comunicaciones') THEN
    RAISE EXCEPTION 'Sin permiso para editar las comunicaciones';
  END IF;

  IF NEW.invitation_config IS DISTINCT FROM OLD.invitation_config THEN
    RAISE EXCEPTION 'Solo el equipo We.Page configura las invitaciones';
  END IF;

  IF (NEW.name IS DISTINCT FROM OLD.name OR NEW.slug IS DISTINCT FROM OLD.slug
      OR NEW.description IS DISTINCT FROM OLD.description OR NEW.event_date IS DISTINCT FROM OLD.event_date
      OR NEW.timezone IS DISTINCT FROM OLD.timezone OR NEW.venue IS DISTINCT FROM OLD.venue
      OR NEW.status IS DISTINCT FROM OLD.status OR NEW.languages IS DISTINCT FROM OLD.languages
      OR NEW.default_language IS DISTINCT FROM OLD.default_language OR NEW.capacity IS DISTINCT FROM OLD.capacity
      OR NEW.registration_closes_at IS DISTINCT FROM OLD.registration_closes_at)
     AND NOT member_can_edit(OLD.id, 'ajustes') THEN
    RAISE EXCEPTION 'Sin permiso para editar los ajustes del evento';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_guard_member_update ON events;
CREATE TRIGGER trg_events_guard_member_update
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_guard_member_update();

-- ─── Imágenes del bucket: diseño o formulario ──────────────────
DROP POLICY IF EXISTS "event-assets write member or super" ON storage.objects;
CREATE POLICY "event-assets write member or super" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'event-assets'
    AND (member_can_edit(((storage.foldername(name))[1])::uuid, 'diseno')
         OR member_can_edit(((storage.foldername(name))[1])::uuid, 'formulario'))
  );
DROP POLICY IF EXISTS "event-assets update member or super" ON storage.objects;
CREATE POLICY "event-assets update member or super" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'event-assets'
    AND (member_can_edit(((storage.foldername(name))[1])::uuid, 'diseno')
         OR member_can_edit(((storage.foldername(name))[1])::uuid, 'formulario'))
  );
DROP POLICY IF EXISTS "event-assets delete member or super" ON storage.objects;
CREATE POLICY "event-assets delete member or super" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'event-assets'
    AND (member_can_edit(((storage.foldername(name))[1])::uuid, 'diseno')
         OR member_can_edit(((storage.foldername(name))[1])::uuid, 'formulario'))
  );

-- ─── Vista de miembros con sus pestañas ───────────────────────
CREATE OR REPLACE VIEW event_members_view AS
  SELECT m.event_id, m.user_id, m.role, m.created_at,
         p.email, p.full_name, p.role AS profile_role, m.tabs
  FROM event_members m
  JOIN profiles p ON p.id = m.user_id;
GRANT SELECT ON event_members_view TO authenticated;
