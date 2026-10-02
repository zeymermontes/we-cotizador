-- pgcrypto vive en el esquema "extensions" en Supabase; con search_path =
-- public las funciones del PIN no encontraban crypt()/gen_salt().
-- Se recrean con el mismo cuerpo y search_path = public, extensions.

CREATE OR REPLACE FUNCTION set_event_scanner_pin(p_event_id UUID, p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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

CREATE OR REPLACE FUNCTION verify_event_scanner_pin(p_slug TEXT, p_pin TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM events
  WHERE slug = p_slug
    AND status IN ('published', 'closed')
    AND scanner_pin_hash IS NOT NULL
    AND scanner_pin_hash = crypt(p_pin, scanner_pin_hash);
  RETURN v_id; -- NULL si no coincide
END;
$$;
