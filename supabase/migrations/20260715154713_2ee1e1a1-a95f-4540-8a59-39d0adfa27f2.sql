
ALTER TABLE public.source_products
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS source_products_project_excluded_idx
  ON public.source_products(project_id, excluded);

-- Backfill: Import-stage products that were included in at least one finished
-- discovery job and have no enrichment (or an enrichment with empty picks).
WITH searched AS (
  SELECT DISTINCT sp.id
  FROM public.source_products sp
  JOIN public.bulk_jobs bj
    ON bj.project_id = sp.project_id
   AND bj.kind = 'FIRECRAWL_DISCOVERY'
   AND bj.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
   AND (
     bj.items::jsonb ? sp.id::text
     OR (bj.payload->'all_items')::jsonb ? sp.id::text
     OR (bj.payload->'completed_items')::jsonb ? sp.id::text
     OR (bj.payload->'failed_items')::jsonb ? sp.id::text
   )
  WHERE COALESCE(sp.pipeline_status, 'IMPORTED') = 'IMPORTED'
    AND sp.excluded = false
    AND NOT EXISTS (
      SELECT 1 FROM public.enrichments e
       WHERE e.source_product_id = sp.id
         AND COALESCE(jsonb_array_length(to_jsonb(e.picked_urls)), 0) > 0
    )
)
UPDATE public.source_products sp
   SET excluded = true,
       excluded_reason = 'auto_no_sources',
       excluded_at = now()
  FROM searched s
 WHERE sp.id = s.id;
