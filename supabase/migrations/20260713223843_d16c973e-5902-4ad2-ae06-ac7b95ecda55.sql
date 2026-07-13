ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.enrichments ADD COLUMN IF NOT EXISTS score_breakdown jsonb DEFAULT NULL;