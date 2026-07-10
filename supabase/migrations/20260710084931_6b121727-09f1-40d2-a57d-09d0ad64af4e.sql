ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS visualization_style_prompt text,
  ADD COLUMN IF NOT EXISTS visualization_requirements_pl text;