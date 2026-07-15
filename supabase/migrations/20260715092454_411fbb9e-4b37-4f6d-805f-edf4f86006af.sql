
REVOKE EXECUTE ON FUNCTION public.claim_next_bulk_job(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_bulk_job(integer) TO service_role;
