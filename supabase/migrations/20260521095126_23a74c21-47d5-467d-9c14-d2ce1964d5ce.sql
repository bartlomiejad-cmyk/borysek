ALTER TABLE public.enrichments ADD COLUMN IF NOT EXISTS regenerated_main_image text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('regenerated-images', 'regenerated-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read regenerated images"
ON storage.objects FOR SELECT
USING (bucket_id = 'regenerated-images');