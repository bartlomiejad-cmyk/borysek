ALTER TABLE public.source_products
  ADD COLUMN IF NOT EXISTS matching_mode text NOT NULL DEFAULT 'strict'
  CHECK (matching_mode IN ('strict','compatible'));

ALTER TABLE public.enrichments
  ADD COLUMN IF NOT EXISTS compat_suggested boolean NOT NULL DEFAULT false;