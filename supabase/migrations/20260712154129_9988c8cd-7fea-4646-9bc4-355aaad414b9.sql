
ALTER TABLE public.enrichments
  ADD COLUMN IF NOT EXISTS allegro_description text,
  ADD COLUMN IF NOT EXISTS allegro_generated_at timestamptz;

ALTER TYPE bulk_job_kind ADD VALUE IF NOT EXISTS 'PIM_ALLEGRO_DESCRIPTION';
