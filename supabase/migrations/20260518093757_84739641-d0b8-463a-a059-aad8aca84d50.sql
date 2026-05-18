
-- Strategia mapowania
CREATE TYPE public.mapping_strategy AS ENUM ('EAN', 'NAZWA', 'HYBRID');
CREATE TYPE public.match_type AS ENUM ('EAN_MATCH', 'NAME_MATCH', 'HYBRID_MATCH', 'NO_MATCH');
CREATE TYPE public.enrichment_status AS ENUM ('PENDING', 'MATCHED', 'GENERATED', 'FAILED');

-- Projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  custom_prompt TEXT NOT NULL DEFAULT '',
  blacklist TEXT[] NOT NULL DEFAULT '{}',
  strategy public.mapping_strategy NOT NULL DEFAULT 'HYBRID',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own projects read" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own projects insert" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own projects update" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own projects delete" ON public.projects FOR DELETE USING (auth.uid() = user_id);

-- Source products (z CSV)
CREATE TABLE public.source_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ext_id TEXT,
  nazwa TEXT,
  kod TEXT,
  ean TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.source_products(project_id);
CREATE INDEX ON public.source_products(project_id, ean);
ALTER TABLE public.source_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp via project" ON public.source_products FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

-- Search results (term -> organic urls)
CREATE TABLE public.search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  organic_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.search_results(project_id);
CREATE INDEX ON public.search_results(project_id, term);
ALTER TABLE public.search_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sr via project" ON public.search_results FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

-- Product sources (scrapowane dane po url)
CREATE TABLE public.product_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);
CREATE INDEX ON public.product_sources(project_id);
ALTER TABLE public.product_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps via project" ON public.product_sources FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

-- Enrichments
CREATE TABLE public.enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_product_id UUID NOT NULL UNIQUE REFERENCES public.source_products(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status public.enrichment_status NOT NULL DEFAULT 'PENDING',
  match_type public.match_type NOT NULL DEFAULT 'NO_MATCH',
  matched_term TEXT,
  picked_urls TEXT[] NOT NULL DEFAULT '{}',
  golden_name TEXT,
  golden_description TEXT,
  model TEXT,
  previous JSONB,
  error TEXT,
  generated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.enrichments(project_id);
CREATE INDEX ON public.enrichments(project_id, status);
ALTER TABLE public.enrichments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "en via project" ON public.enrichments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_uat BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_enrichments_uat BEFORE UPDATE ON public.enrichments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage bucket dla oryginalnych plików
INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', false) ON CONFLICT DO NOTHING;
CREATE POLICY "uploads read own" ON storage.objects FOR SELECT USING (bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "uploads write own" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "uploads delete own" ON storage.objects FOR DELETE USING (bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
