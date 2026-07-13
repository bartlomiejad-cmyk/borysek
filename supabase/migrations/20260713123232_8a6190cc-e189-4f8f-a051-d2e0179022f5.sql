
-- project_shares: jeden aktywny link per projekt
CREATE TABLE public.project_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  salt text NOT NULL,
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_shares TO authenticated;
GRANT ALL ON public.project_shares TO service_role;

ALTER TABLE public.project_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shares via project" ON public.project_shares
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_shares.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_shares.project_id AND p.user_id = auth.uid()));

CREATE TRIGGER trg_project_shares_uat BEFORE UPDATE ON public.project_shares
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX project_shares_token_idx ON public.project_shares(token);

-- client_feedback: komentarze i flagi od klientów
CREATE TABLE public.client_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.source_products(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('comment','needs_fix')),
  body text NOT NULL,
  author_name text,
  share_token text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_feedback TO authenticated;
GRANT ALL ON public.client_feedback TO service_role;

ALTER TABLE public.client_feedback ENABLE ROW LEVEL SECURITY;

-- Właściciel projektu może czytać, aktualizować (resolved) i usuwać własny feedback.
-- Insert wykonuje wyłącznie serwer (service_role) po weryfikacji tokenu+hasła w publicznym API.
CREATE POLICY "feedback owner read" ON public.client_feedback
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = client_feedback.project_id AND p.user_id = auth.uid()));

CREATE POLICY "feedback owner update" ON public.client_feedback
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = client_feedback.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = client_feedback.project_id AND p.user_id = auth.uid()));

CREATE POLICY "feedback owner delete" ON public.client_feedback
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = client_feedback.project_id AND p.user_id = auth.uid()));

CREATE TRIGGER trg_client_feedback_uat BEFORE UPDATE ON public.client_feedback
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX client_feedback_project_idx ON public.client_feedback(project_id, created_at DESC);
CREATE INDEX client_feedback_product_idx ON public.client_feedback(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX client_feedback_unresolved_idx ON public.client_feedback(project_id) WHERE resolved = false;
