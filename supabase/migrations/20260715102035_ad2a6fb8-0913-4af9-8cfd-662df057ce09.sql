ALTER TABLE public.source_products ADD COLUMN IF NOT EXISTS category text;
CREATE INDEX IF NOT EXISTS source_products_project_category_idx
  ON public.source_products (project_id, category);