-- Enable pg_cron + pg_net for scheduled background work
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Close out stale jobs so the UI is not blocked
update public.bulk_jobs
set status = 'CANCELLED',
    finished_at = coalesce(finished_at, now())
where status in ('PENDING','PROCESSING')
  and (cancel_requested = true or processed_count = 0 and created_at < now() - interval '5 minutes');

-- Schedule the worker to run every minute
select cron.schedule(
  'process-bulk-jobs-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://project--a56746f2-6fdf-47b1-8095-043a41af98fd.lovable.app/api/public/hooks/process-bulk-jobs',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6bWV4Z3FrcXRza3V1bm9ueXdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwODkwMjksImV4cCI6MjA5NDY2NTAyOX0.E2G1KDIcWwdc-pJS2TYdWT8m0xD6c3vID090E96tPow'
    ),
    body := '{}'::jsonb
  );
  $$
);