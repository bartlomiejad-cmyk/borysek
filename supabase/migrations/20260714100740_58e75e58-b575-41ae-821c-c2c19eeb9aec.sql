ALTER TABLE public.source_products
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

ALTER TABLE public.project_shares
  ADD COLUMN IF NOT EXISTS approved_only boolean NOT NULL DEFAULT false;