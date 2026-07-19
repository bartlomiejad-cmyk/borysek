-- P7 — backfill defaultów FR1/FR2 do public.projects.settings.
-- Idempotentny: dokłada wyłącznie brakujące klucze (guard ? 'key'),
-- nie nadpisuje istniejących wartości. Defaulty = status quo, więc
-- backfill nie zmienia zachowania żadnego projektu.

UPDATE public.projects
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('search_query_strategy', 'ALL')
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'search_query_strategy');

UPDATE public.projects
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('top_per_variant', 2)
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'top_per_variant');

UPDATE public.projects
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('serp_limit', 10)
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'serp_limit');