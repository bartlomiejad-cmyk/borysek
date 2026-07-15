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
  ORDER BY
    CASE
      WHEN status = 'PENDING'::public.bulk_job_status AND locked_at IS NULL THEN 0
      WHEN status = 'PENDING'::public.bulk_job_status THEN 1
      WHEN status = 'PROCESSING'::public.bulk_job_status AND locked_at IS NOT NULL THEN 2
      ELSE 3
    END,
    COALESCE(locked_at, created_at) ASC,
    created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.bulk_jobs
     SET locked_at = now(),
         lock_token = gen_random_uuid(),
         status = CASE WHEN status = 'PENDING'::public.bulk_job_status THEN 'PROCESSING'::public.bulk_job_status ELSE status END,
         started_at = COALESCE(started_at, now())
   WHERE id = claimed_id
  RETURNING *;
END;
$$;