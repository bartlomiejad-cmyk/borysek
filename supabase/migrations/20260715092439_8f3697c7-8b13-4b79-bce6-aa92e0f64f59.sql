
ALTER TABLE public.bulk_jobs
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_token uuid;

CREATE INDEX IF NOT EXISTS bulk_jobs_status_created_idx
  ON public.bulk_jobs (status, created_at);

-- Atomically claim the oldest PENDING/PROCESSING job whose lock is free or
-- stale (>3 min). SKIP LOCKED prevents two concurrent worker ticks from
-- returning the same row.
CREATE OR REPLACE FUNCTION public.claim_next_bulk_job(p_stale_seconds integer DEFAULT 180)
RETURNS SETOF public.bulk_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  SELECT id INTO claimed_id
  FROM public.bulk_jobs
  WHERE status IN ('PENDING','PROCESSING')
    AND cancel_requested = false
    AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => p_stale_seconds))
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.bulk_jobs
     SET locked_at = now(),
         lock_token = gen_random_uuid(),
         status = CASE WHEN status = 'PENDING' THEN 'PROCESSING'::bulk_job_status ELSE status END,
         started_at = COALESCE(started_at, now())
   WHERE id = claimed_id
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_bulk_job(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_bulk_job(integer) TO service_role;
