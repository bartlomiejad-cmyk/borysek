
-- 1) usage telemetry column on bulk_jobs
ALTER TABLE public.bulk_jobs ADD COLUMN IF NOT EXISTS usage jsonb;

-- 2) cross-project raw scrape cache
CREATE TABLE IF NOT EXISTS public.scrape_cache (
  url_hash text PRIMARY KEY,
  url text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  title text,
  markdown text,
  images jsonb,
  status text NOT NULL DEFAULT 'ok'
);

CREATE INDEX IF NOT EXISTS scrape_cache_user_scraped_at_idx
  ON public.scrape_cache (user_id, scraped_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scrape_cache TO authenticated;
GRANT ALL ON public.scrape_cache TO service_role;

ALTER TABLE public.scrape_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scrape_cache owner read"
  ON public.scrape_cache FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "scrape_cache owner write"
  ON public.scrape_cache FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "scrape_cache owner update"
  ON public.scrape_cache FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "scrape_cache owner delete"
  ON public.scrape_cache FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
