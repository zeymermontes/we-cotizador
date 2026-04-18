-- Add document tracking columns to quotations table
ALTER TABLE public.quotations 
ADD COLUMN IF NOT EXISTS document_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS document_pdf_url text,
ADD COLUMN IF NOT EXISTS document_error text;

-- Add a comment explaining the states
COMMENT ON COLUMN public.quotations.document_status IS 'Tracks automation status: pending, generating, completed, failed';
