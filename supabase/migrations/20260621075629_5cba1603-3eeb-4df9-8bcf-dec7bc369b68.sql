ALTER TABLE public.enrichments
  ADD COLUMN IF NOT EXISTS golden_slug text,
  ADD COLUMN IF NOT EXISTS golden_meta_description text,
  ADD COLUMN IF NOT EXISTS golden_seo_keywords jsonb;