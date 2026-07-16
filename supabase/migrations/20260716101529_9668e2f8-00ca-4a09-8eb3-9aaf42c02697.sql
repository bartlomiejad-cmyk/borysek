
ALTER TABLE public.source_products
  ADD COLUMN IF NOT EXISTS row_kind text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS parent_sku text DEFAULT NULL;

ALTER TABLE public.source_products
  DROP CONSTRAINT IF EXISTS source_products_row_kind_chk;
ALTER TABLE public.source_products
  ADD CONSTRAINT source_products_row_kind_chk
  CHECK (row_kind IN ('main','variant'));

CREATE INDEX IF NOT EXISTS source_products_row_kind_idx
  ON public.source_products (project_id, row_kind);
CREATE INDEX IF NOT EXISTS source_products_parent_sku_idx
  ON public.source_products (project_id, parent_sku)
  WHERE parent_sku IS NOT NULL;
