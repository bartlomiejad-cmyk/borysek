ALTER TYPE public.bulk_job_kind ADD VALUE IF NOT EXISTS 'PIM_RESCRAPE';
ALTER TABLE public.enrichments ADD COLUMN IF NOT EXISTS rescrape_rounds integer NOT NULL DEFAULT 0;