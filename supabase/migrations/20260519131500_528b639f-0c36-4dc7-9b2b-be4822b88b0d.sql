
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS include_extra_images boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS code_column text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ean_column  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS name_column text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS id_column   text NOT NULL DEFAULT '';

ALTER TABLE product_sources
  ADD COLUMN IF NOT EXISTS extra_images jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE enrichments
  ADD COLUMN IF NOT EXISTS hidden_images   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS golden_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quality         jsonb;
