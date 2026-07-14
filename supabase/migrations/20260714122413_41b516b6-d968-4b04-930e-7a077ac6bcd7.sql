
CREATE TABLE public.product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.source_products(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  message text NOT NULL,
  meta jsonb DEFAULT NULL
);

CREATE INDEX product_events_product_at_idx ON public.product_events (product_id, at DESC);
CREATE INDEX product_events_project_idx ON public.product_events (project_id);

GRANT SELECT ON public.product_events TO authenticated;
GRANT ALL ON public.product_events TO service_role;

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_events via project owner"
ON public.product_events
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = product_events.project_id
    AND p.user_id = auth.uid()
));
