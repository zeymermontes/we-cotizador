-- ─── Auditoría del MCP ────────────────────────────────────────
-- Cada herramienta que la IA ejecuta a través del servidor MCP deja
-- una fila: quién, qué herramienta, con qué argumentos y resultado.

CREATE TABLE IF NOT EXISTS mcp_audit (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tool       TEXT NOT NULL,
  args       JSONB NOT NULL DEFAULT '{}'::jsonb,
  result     TEXT NOT NULL CHECK (result IN ('ok', 'error')),
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_created ON mcp_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_user ON mcp_audit(user_id, created_at DESC);

ALTER TABLE mcp_audit ENABLE ROW LEVEL SECURITY;

-- Cada usuario registra lo suyo; solo super lo consulta todo.
DROP POLICY IF EXISTS "mcp_audit insert own" ON mcp_audit;
CREATE POLICY "mcp_audit insert own" ON mcp_audit
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "mcp_audit select own or super" ON mcp_audit;
CREATE POLICY "mcp_audit select own or super" ON mcp_audit
  FOR SELECT USING (user_id = auth.uid() OR is_super());
