-- Repair customer photos overwritten by runRegenerateMedia before the client-owned
-- guard existed (AUDIT P0-1). Damaged = was a customer import (imported_images present,
-- non-empty) but the "__imported__" sentinel was overwritten by an AI packshot URL.
-- Restore the original customer main and the sentinel from image_meta.imported_images[0].
-- Idempotent: repaired rows then satisfy regenerated_main_image = '__imported__' and are
-- excluded by the predicate, so re-running is a no-op.
UPDATE public.enrichments
SET
  pinned_main_url = image_meta -> 'imported_images' ->> 0,
  regenerated_main_image = '__imported__'
WHERE image_meta ? 'imported_images'
  AND jsonb_typeof(image_meta -> 'imported_images') = 'array'
  AND jsonb_array_length(image_meta -> 'imported_images') > 0
  AND COALESCE(regenerated_main_image, '') <> '__imported__';

-- CONTROL (expect 0 rows after the UPDATE): any still-damaged row.
-- SELECT count(*) FROM public.enrichments
-- WHERE image_meta ? 'imported_images'
--   AND jsonb_typeof(image_meta -> 'imported_images') = 'array'
--   AND jsonb_array_length(image_meta -> 'imported_images') > 0
--   AND COALESCE(regenerated_main_image, '') <> '__imported__';