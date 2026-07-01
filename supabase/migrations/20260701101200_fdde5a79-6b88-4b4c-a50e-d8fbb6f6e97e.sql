DROP POLICY "bulk_jobs via project owner" ON public.bulk_jobs;
CREATE POLICY "bulk_jobs via project owner" ON public.bulk_jobs FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bulk_jobs.project_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.photo_projects pp WHERE pp.id = bulk_jobs.project_id AND pp.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bulk_jobs.project_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.photo_projects pp WHERE pp.id = bulk_jobs.project_id AND pp.user_id = auth.uid())
);