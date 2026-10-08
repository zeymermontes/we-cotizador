-- Las respuestas no se entienden sin las preguntas: quien tiene Registros o
-- Comunicaciones puede LEER el formulario (borrador y versiones) aunque no
-- tenga la pestaña Formulario. Editarlo y publicarlo siguen exigiendo
-- Formulario (member_can_edit en INSERT/UPDATE/DELETE y en publish_event_form).
DROP POLICY IF EXISTS "event_forms read" ON event_forms;
CREATE POLICY "event_forms read" ON event_forms FOR SELECT
  USING (member_any_tab(event_id, ARRAY['formulario', 'registros', 'comunicaciones']));

DROP POLICY IF EXISTS "form_versions read" ON form_versions;
CREATE POLICY "form_versions read" ON form_versions FOR SELECT
  USING (member_any_tab(event_id, ARRAY['formulario', 'registros', 'comunicaciones']));
