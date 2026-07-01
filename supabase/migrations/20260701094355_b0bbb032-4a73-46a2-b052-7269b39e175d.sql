
CREATE TABLE public.photo_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  variants_per_product integer NOT NULL DEFAULT 2,
  style_prompt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_projects TO authenticated;
GRANT ALL ON public.photo_projects TO service_role;
ALTER TABLE public.photo_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own photo_projects" ON public.photo_projects FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER photo_projects_touch BEFORE UPDATE ON public.photo_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.photo_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.photo_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text,
  description text,
  source_image_url text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  thumbnail_url text,
  lifestyle_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_products TO authenticated;
GRANT ALL ON public.photo_products TO service_role;
ALTER TABLE public.photo_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own photo_products" ON public.photo_products FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX photo_products_project_idx ON public.photo_products(project_id, created_at);
CREATE TRIGGER photo_products_touch BEFORE UPDATE ON public.photo_products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Allow bulk_job_events to reference photo_products too — the existing FK is
-- to source_products, so drop it if present and leave source_product_id as a
-- loose reference (we already store project_id + job_id for scoping).
ALTER TABLE public.bulk_job_events
  DROP CONSTRAINT IF EXISTS bulk_job_events_source_product_id_fkey;
