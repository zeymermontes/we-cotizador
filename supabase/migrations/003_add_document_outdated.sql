-- Track when a quotation's prices/data changed after the last document generation
ALTER TABLE public.quotations
ADD COLUMN IF NOT EXISTS document_outdated boolean DEFAULT false;

COMMENT ON COLUMN public.quotations.document_outdated IS 'True when prices/data changed after the last document generation; the document needs to be regenerated';
