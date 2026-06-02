## Cel
Dodać widoczny na żywo log z postępu wyszukiwania źródeł (Firecrawl) — tak, żeby było widać per‑produkt: jakie zapytanie poszło, ile linków znalazł, ile zostało po filtracji, ile zescrape'owało, a w razie błędu — jaki.

## Co dodać

### 1. Tabela `bulk_job_events` (migracja)
```
id uuid pk
job_id uuid (idx)
project_id uuid (idx, do RLS)
source_product_id uuid null
level text ('info' | 'success' | 'warn' | 'error')
message text         -- krótki opis np. "Bosch GWS 750 — 5 wyników, 3 po filtrze, 3 scraped"
details jsonb        -- { query, organic_urls, filtered_urls, scraped, error }
created_at timestamptz default now()
```
RLS przez `project_id` (analogicznie do `search_results`). GRANT dla authenticated + service_role. Realtime publication ON dla tej tabeli.

### 2. Worker — emitowanie zdarzeń
W `src/lib/pim/_workers.server.ts` w `runFirecrawlDiscovery` (i analogicznie w `runGenerateGolden`, `runRegenerateMedia`) po każdym produkcie zapisać 1 wiersz do `bulk_job_events`:
- info na start ("Szukam: <query>")
- success z liczbami (znalezione / po filtrze / scraped / images)
- error z komunikatem przy wyjątku

### 3. UI — panel "Log na żywo"
Nowy komponent `BulkJobLog` użyty w `projects.$id.index.tsx` pod paskiem postępu aktywnego joba:
- subskrypcja realtime na `bulk_job_events` filtrowana po `job_id`
- przewijana lista (max ~200 ostatnich), kolorowane wg `level`, czas + nazwa produktu + message
- przycisk "Wyczyść widok" (lokalnie, nie kasuje z bazy)
- fallback polling co 3s gdy realtime nie zadziała

### 4. Sprzątanie
Trigger / okresowe usuwanie eventów starszych niż 7 dni — opcjonalne, do późniejszej iteracji.

## Pliki
- `supabase/migrations/<ts>_bulk_job_events.sql` — tabela + RLS + GRANT + realtime
- `src/lib/pim/_workers.server.ts` — emit eventów
- `src/components/pim/BulkJobLog.tsx` — nowy komponent
- `src/routes/_auth/projects.$id.index.tsx` — wpięcie pod aktywnymi jobami

## Uwagi
- Log działa dla wszystkich 3 typów jobów (FIRECRAWL_DISCOVERY, GENERATE_GOLDEN, REGENERATE_MEDIA).
- Żeby zobaczyć efekt produkcyjnie — po wdrożeniu trzeba opublikować (cron uderza w published URL).
