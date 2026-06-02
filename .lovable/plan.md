# Problem
Status zadania utyka na "Zatrzymywanie... 129/632" i nigdy nie kończy się jako CANCELLED. Stop nie działa, bo:

1. `cancelBulkJob` dla `PROCESSING` ustawia **tylko** `cancel_requested=true` — licząc, że następne uruchomienie workera dokończy bieżący item i sfinalizuje status.
2. Worker (`process-bulk-jobs.ts → pickNextJob`) filtruje `eq("cancel_requested", false)`, więc **nigdy więcej nie pobierze tego joba**. Skoro nie pobierze — nie zaktualizuje statusu na `CANCELLED`.
3. W efekcie wiersz na zawsze tkwi w `PROCESSING + cancel_requested=true`. UI widzi to jako "Zatrzymywanie…" w nieskończoność, a nowe zadanie tego samego typu nie da się odpalić (blokada `existing` w `startFirecrawlDiscovery` / `createBulkJob`).

(Dodatkowo: kolejne cron‑ticki naprawdę nie wykonują już żadnych itemów tego joba — ale UI tego nie pokazuje.)

# Naprawa

### 1. `src/lib/pim/bulk-jobs.functions.ts` — `cancelBulkJob`
Dla `PROCESSING` od razu zapisać terminalny stan:
```
update bulk_jobs
set status = 'CANCELLED',
    cancel_requested = true,
    finished_at = now()
where id = :jobId
  and status = 'PROCESSING'
```
(zostaje też istniejący update dla `PENDING`.)

Skutek: UI natychmiast widzi "Anulowano", blokada `existing` znika, można odpalić nowe zadanie. Jeśli akurat trwa wywołanie workera, jego pętla i tak przerwie się na kolejnym `cancelCheck`, a zapisy postępu w trakcie nie nadpisują `status`.

### 2. `src/routes/api/public/hooks/process-bulk-jobs.ts` — `pickNextJob`
Zostawić selektor jak jest (pomija zadania `cancel_requested=true`), tak żeby cron nie próbował już niczego robić z zatrzymanym jobem. Po zmianie z punktu 1 nie ma już ryzyka, że job utknie.

### 3. UI (opcjonalnie, ale czyste) — `BulkJobLog` / pasek postępu w `src/routes/_auth/projects.$id.index.tsx`
Po pomyślnym `cancelBulkJob` od razu `refetch` aktywnego joba (już to robimy), więc nic dodatkowego nie trzeba — wystarczy fix backendowy.

# Pliki do zmiany
- `src/lib/pim/bulk-jobs.functions.ts`
- (bez migracji DB, bez zmian schematu)

# Po wdrożeniu
Publish wymagany, bo cron i worker działają na opublikowanej wersji. Aktualny "zawieszony" wiersz z 23:37 można ręcznie zamknąć — albo wyślij ponownie "Zatrzymaj", po deployu nowa wersja `cancelBulkJob` od razu go zamknie.
