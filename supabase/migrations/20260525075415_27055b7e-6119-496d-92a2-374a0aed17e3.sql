UPDATE public.media_technical_settings
SET component_a = ''
WHERE project_id IN (
  SELECT id FROM public.projects WHERE user_id = '4c25072e-8cb1-4aad-b57f-164c25ecbb38'
);