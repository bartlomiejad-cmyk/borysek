CREATE TYPE public.pim_pipeline_status AS ENUM (
  'IMPORTED','SOURCES_FOUND','MATCHED','GOLDEN_READY','VISUALS_READY'
);
CREATE TYPE public.pim_review_status AS ENUM (
  'NONE','AI_FLAGGED','NEEDS_REVIEW','APPROVED'
);

ALTER TABLE public.source_products
  ADD COLUMN pipeline_status public.pim_pipeline_status NOT NULL DEFAULT 'IMPORTED',
  ADD COLUMN review_status public.pim_review_status NOT NULL DEFAULT 'NONE',
  ADD COLUMN manual_lock boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_source_products_pipeline_status
  ON public.source_products(project_id, pipeline_status);

WITH derived AS (
  SELECT
    sp.id AS product_id,
    CASE
      WHEN e.regenerated_main_image IS NOT NULL
        OR jsonb_typeof(coalesce(e.ai_gallery_urls, '[]'::jsonb)) = 'array'
           AND jsonb_array_length(coalesce(e.ai_gallery_urls, '[]'::jsonb)) > 0
        THEN 'VISUALS_READY'::public.pim_pipeline_status
      WHEN e.status = 'GENERATED' OR e.golden_name IS NOT NULL
        THEN 'GOLDEN_READY'::public.pim_pipeline_status
      WHEN e.picked_urls IS NOT NULL AND array_length(e.picked_urls, 1) > 0
        THEN 'MATCHED'::public.pim_pipeline_status
      WHEN EXISTS (
        SELECT 1 FROM public.search_results sr
        WHERE sr.project_id = sp.project_id
          AND lower(trim(sr.term)) IN (
            lower(trim(coalesce(sp.nazwa, ''))),
            lower(trim(coalesce(sp.ean, ''))),
            lower(trim(coalesce(sp.nazwa, '') || ' ' || coalesce(sp.ean, '')))
          )
          AND sr.organic_urls IS NOT NULL
          AND jsonb_typeof(coalesce(sr.organic_urls, '[]'::jsonb)) = 'array'
          AND jsonb_array_length(coalesce(sr.organic_urls, '[]'::jsonb)) > 0
      )
        THEN 'SOURCES_FOUND'::public.pim_pipeline_status
      ELSE 'IMPORTED'::public.pim_pipeline_status
    END AS ps,
    (e.pinned_main_url IS NOT NULL) AS lock
  FROM public.source_products sp
  LEFT JOIN public.enrichments e ON e.source_product_id = sp.id
)
UPDATE public.source_products sp
SET pipeline_status = d.ps,
    manual_lock = coalesce(d.lock, false)
FROM derived d
WHERE d.product_id = sp.id;
