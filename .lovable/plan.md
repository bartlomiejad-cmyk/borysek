## Cel

Bulk-akcje (Generuj złote rekordy, Regeneruj tła) mają się wykonywać po stronie serwera, niezależnie od przeglądarki. Zamknięcie karty / odświeżenie / restart komputera nie przerywa pracy. Przycisk Zatrzymaj nadal działa (przez flagę w bazie).

## Architektura

```
[Klient]                       [DB]                          [Cron worker]
  │                              │                                │
  │ createBulkJob(kind,items)─▶ bulk_jobs(status=PENDING) ◀──── pg_cron (każda minuta)
  │                              │   ▲                            │ POST /api/public/hooks/process-bulk-jobs
  │ poll co 3s ───────────────▶  │   │                            │   ├─ bierze 1 job PENDING/PROCESSING
  │ progress bar / cancel        │   │                            │   ├─ przetwarza ~10 itemów (limit ~25s)
  │                              │   │                            │   ├─ aktualizuje processed/cancel
  │ cancelBulkJob ──────────────▶ cancel_requested=true ──────────┘   └─ wraca do PENDING lub COMPLETED
```

Wszystko, co już zostało zakolejkowane, trafia do DB i jest odporne na zamknięcie przeglądarki. Cron uruchamia worker co minutę i ten przerabia kolejną paczkę itemów w ramach limitu Workera Cloudflare (~30s).

## Implementacja

1. **Migracja `bulk_jobs`**
   - kolumny: `id`, `project_id`, `user_id`, `kind` (`GENERATE_GOLDEN` | `REGENERATE_MEDIA`), `items jsonb` (lista product_id do zrobienia), `processed_count int`, `failed_count int`, `total int`, `status` (`PENDING|PROCESSING|COMPLETED|CANCELLED|FAILED`), `cancel_requested bool`, `last_error text`, `started_at`, `finished_at`, `created_at`, `updated_at`
   - RLS: user widzi tylko swoje (po `user_id = auth.uid()`)
   - Unique partial index: jeden aktywny job na (project_id, kind) jednocześnie

2. **Refaktor istniejących funkcji**
   - Wydzielić ciała handlerów `regenerateMedia`, `generateGoldenRecord`, `verifySources` do helperów w `*.server.ts` przyjmujących `SupabaseClient` (przekazujemy `supabaseAdmin` z workera, `context.supabase` z user-facing serverFn).
   - Istniejące serverFn pozostają (`requireSupabaseAuth` + wywołanie helpera) — UI dla pojedynczego produktu działa bez zmian.

3. **Nowe serverFn** w `src/lib/pim/bulk-jobs.functions.ts`:
   - `createBulkJob({ projectId, kind, items })` — tworzy job (rzuca jeśli aktywny już istnieje)
   - `getActiveBulkJob({ projectId, kind })` — używane przez UI do hydratacji + polling
   - `cancelBulkJob({ jobId })` — ustawia `cancel_requested=true`

4. **Worker `POST /api/public/hooks/process-bulk-jobs`**
   - Bierze JEDEN job (kolejność FIFO, status PENDING/PROCESSING, niezakończony, `cancel_requested=false`).
   - Pętla maks. ~25s (budżet czasowy) lub do końca itemów. Przetwarza item po item (kind decyduje co woła). Co 1–2 itemy zapisuje progres + sprawdza `cancel_requested`.
   - Po wyjściu z pętli: aktualizuje status (`COMPLETED` jeśli items puste, `CANCELLED` jeśli flaga, w przeciwnym razie zostawia `PROCESSING` żeby cron złapał za minutę).
   - Walidacja inputu (apikey) — endpoint pod `/api/public/*` więc bez auth bramy, ale w środku weryfikujemy nagłówek `apikey` względem anon key.

5. **pg_cron**: co minutę `net.http_post` na endpoint workera z `apikey` w nagłówku (insert tool, nie migracja).

6. **UI `projects.$id.index.tsx`**
   - Usuwam pętlę w `generateAll` / `regenerateAll` — zamiast iteracji woła `createBulkJob`.
   - Nowy `useQuery` na `getActiveBulkJob` z `refetchInterval: 3000` zarówno dla `GENERATE_GOLDEN` jak i `REGENERATE_MEDIA`.
   - Karty postępu używają danych z DB; przycisk Zatrzymaj woła `cancelBulkJob`.
   - Po `COMPLETED/CANCELLED/FAILED` toast + refetch produktów.

## Trade-offy

- Throughput: ~10 itemów / minutę / kind / projekt (regulowane stałą `BATCH_SIZE`). Akceptowalne dla typowych volumenów; w razie potrzeby łatwo zwiększyć paczkę / dodać równoległość wewnątrz workera.
- Maks. opóźnienie wznowienia po awarii: 1 minuta (interwał crona).
- Zatrzymanie: do paczki bieżącej (max kilka–kilkanaście sekund).

## Co użytkownik zobaczy

- Klika „Regeneruj tła" / „Generuj złote rekordy" → toast „Zadanie uruchomione w tle (X produktów)" i karta postępu od razu pokazuje 0/X.
- Może zamknąć kartę. Po powrocie karta postępu sama się hydratuje i pokazuje aktualny stan.
- Przycisk Zatrzymaj wciąż działa.
