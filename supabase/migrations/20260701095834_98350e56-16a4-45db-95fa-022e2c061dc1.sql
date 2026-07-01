
ALTER TABLE public.photo_products
  ADD COLUMN IF NOT EXISTS source_image_urls text[] NOT NULL DEFAULT '{}';

UPDATE public.photo_products
SET source_image_urls = ARRAY[source_image_url]
WHERE (source_image_urls IS NULL OR array_length(source_image_urls, 1) IS NULL)
  AND source_image_url IS NOT NULL;

-- Storage policies for photo-tool-sources/ prefix inside the existing public
-- regenerated-images bucket. Path convention: photo-tool-sources/<user_id>/...
DROP POLICY IF EXISTS "photo-tool-sources insert own" ON storage.objects;
CREATE POLICY "photo-tool-sources insert own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'regenerated-images'
    AND (storage.foldername(name))[1] = 'photo-tool-sources'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "photo-tool-sources delete own" ON storage.objects;
CREATE POLICY "photo-tool-sources delete own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'regenerated-images'
    AND (storage.foldername(name))[1] = 'photo-tool-sources'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
