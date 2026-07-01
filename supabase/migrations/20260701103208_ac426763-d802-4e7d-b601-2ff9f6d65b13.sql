ALTER TABLE public.photo_projects ADD COLUMN IF NOT EXISTS requirements_pl text;
ALTER TABLE public.photo_products ADD COLUMN IF NOT EXISTS generated_thumb_prompt text;
ALTER TABLE public.photo_products ADD COLUMN IF NOT EXISTS generated_lifestyle_prompt text;
ALTER TABLE public.photo_products ADD COLUMN IF NOT EXISTS prompt_source_hash text;