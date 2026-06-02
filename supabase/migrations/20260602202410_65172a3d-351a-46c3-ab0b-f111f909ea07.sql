UPDATE public.bulk_jobs
SET status = 'CANCELLED',
    cancel_requested = true,
    finished_at = COALESCE(finished_at, now())
WHERE id = '9bb8c4f9-7e14-4ac8-83ef-3ecfdbcd5572';