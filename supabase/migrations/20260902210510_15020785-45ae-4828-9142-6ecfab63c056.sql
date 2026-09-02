CREATE TABLE public.sample_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_url text NOT NULL,
  products_range text NOT NULL,
  email text NOT NULL,
  message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT INSERT ON public.sample_requests TO anon;
GRANT SELECT, INSERT ON public.sample_requests TO authenticated;
GRANT ALL ON public.sample_requests TO service_role;
ALTER TABLE public.sample_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit a sample request" ON public.sample_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can read sample requests" ON public.sample_requests FOR SELECT TO authenticated USING (true);