CREATE OR REPLACE FUNCTION public.claim_next_bulk_job(p_stale_seconds integer DEFAULT 180)
 RETURNS SETOF bulk_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  claimed_id uuid;
BEGIN
  SELECT id INTO claimed_id
  FROM public.bulk_jobs
  WHERE status IN ('PENDING','PROCESSING')
    AND cancel_requested = false
    AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => p_stale_seconds))
  ORDER BY
    -- PENDING jobs first (never picked up yet). Among PROCESSING jobs
    -- (locked or just-released) treat both the same and round-robin by
    -- the least-recently-touched heuristic below, so a job that released
    -- its lock after an item cannot be starved by a sibling still holding
    -- a fresh lock.
    CASE WHEN status = 'PENDING'::public.bulk_job_status THEN 0 ELSE 1 END,
    COALESCE(locked_at, updated_at, created_at) ASC,
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
$function$;