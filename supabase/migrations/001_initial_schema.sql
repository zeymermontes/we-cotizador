-- ─── We.Page Cotizador — Database Schema ─────────────────────
-- Run this in Supabase SQL Editor to create the required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Clients ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  referral_source TEXT,
  wedding_planner TEXT,
  event_type TEXT,
  event_date TEXT,
  lang TEXT DEFAULT 'es',
  status TEXT DEFAULT 'nuevo' CHECK (status IN ('nuevo', 'cotizado', 'anticipo', 'en_proceso', 'finalizado', 'cancelado')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Quotations ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,
  base_price NUMERIC DEFAULT 0,
  extras_price NUMERIC DEFAULT 0,
  total_price NUMERIC DEFAULT 0,
  responses JSONB DEFAULT '{}',
  price_breakdown JSONB DEFAULT '{}',
  guest_count_range TEXT,
  status TEXT DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'enviada', 'aceptada', 'rechazada')),
  drive_document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Payments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('anticipo', 'pago', 'finiquito', 'extra')),
  amount NUMERIC NOT NULL,
  description TEXT,
  payment_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'pagado', 'cancelado')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Documents ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('cotizacion_pptx', 'propuesta', 'contrato', 'otro')),
  drive_url TEXT,
  file_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_quotations_client_id ON quotations(client_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_payments_quotation_id ON payments(quotation_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- ─── Row Level Security ──────────────────────────────────────
-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Public: anyone can INSERT clients and quotations (form submission)
CREATE POLICY "Allow public inserts on clients" ON clients
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public inserts on quotations" ON quotations
  FOR INSERT WITH CHECK (true);

-- Authenticated admin: full access
CREATE POLICY "Admin full access clients" ON clients
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin full access quotations" ON quotations
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin full access payments" ON payments
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin full access documents" ON documents
  FOR ALL USING (auth.role() = 'authenticated');

-- ─── Updated_at trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quotations_updated_at BEFORE UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
