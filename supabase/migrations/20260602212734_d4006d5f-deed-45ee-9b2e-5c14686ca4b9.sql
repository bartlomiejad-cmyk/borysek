CREATE TABLE public.bulk_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_product_id uuid NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bulk_job_events_job ON public.bulk_job_events(job_id, created_at DESC);
CREATE INDEX idx_bulk_job_events_project ON public.bulk_job_events(project_id, created_at DESC);

GRANT SELECT, INSERT ON public.bulk_job_events TO authenticated;
GRANT ALL ON public.bulk_job_events TO service_role;

ALTER TABLE public.bulk_job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bje via project"
ON public.bulk_job_events
FOR ALL
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bulk_job_events.project_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bulk_job_events.project_id AND p.user_id = auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.bulk_job_events;
ALTER TABLE public.bulk_job_events REPLICA IDENTITY FULL;