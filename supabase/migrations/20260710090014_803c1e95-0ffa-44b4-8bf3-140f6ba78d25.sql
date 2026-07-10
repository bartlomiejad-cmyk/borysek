ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS visualization_style_prompt TEXT,
  ADD COLUMN IF NOT EXISTS visualization_requirements_pl TEXT;