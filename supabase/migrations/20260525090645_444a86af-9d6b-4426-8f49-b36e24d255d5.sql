-- enums
CREATE TYPE public.bulk_job_kind AS ENUM ('GENERATE_GOLDEN', 'REGENERATE_MEDIA');
CREATE TYPE public.bulk_job_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');

CREATE TABLE public.bulk_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind public.bulk_job_kind NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status public.bulk_job_status NOT NULL DEFAULT 'PENDING',
  cancel_requested boolean NOT NULL DEFAULT false,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bulk_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bulk_jobs via project owner" ON public.bulk_jobs
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bulk_jobs.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bulk_jobs.project_id AND p.user_id = auth.uid()));

-- One active job per (project, kind)
CREATE UNIQUE INDEX bulk_jobs_one_active_per_kind
  ON public.bulk_jobs (project_id, kind)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE INDEX bulk_jobs_pickup ON public.bulk_jobs (status, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE TRIGGER bulk_jobs_touch_updated_at
  BEFORE UPDATE ON public.bulk_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();