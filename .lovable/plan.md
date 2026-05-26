## Cel
Naprawić dwa problemy:
- złote rekordy stoją w kolejce bez postępu, a „Zatrzymaj” nie kończy poprawnie zadania,
- generowane opisy brzmią zbyt sztucznie/marketingowo.

## Co znalazłem
- W bazie są zadania `GENERATE_GOLDEN` w stanie `PENDING` z `processed_count = 0`, więc nie są podejmowane przez worker.
- Jedno zadanie ma `cancel_requested = true`, ale nadal ma status `PENDING`, więc UI może wyglądać jak zawieszone.
- Endpoint workerowy istnieje, ale w kodzie nie widać konfiguracji, która regularnie go uruchamia.
- Generowanie złotych rekordów w tle robi teraz także weryfikację źródeł/zdjęć przed każdym produktem, co mocno wydłuża wykonanie i utrudnia szybkie zatrzymanie.

## Plan zmian

### 1. Naprawić kolejkę zadań w tle
- Dodać/uzupełnić mechanizm cyklicznego uruchamiania endpointu `process-bulk-jobs`, żeby zadania `PENDING` faktycznie przechodziły do `PROCESSING` i zwiększały postęp.
- Dodać natychmiastowe „kopnięcie” zadania po kliknięciu „Generuj złote rekordy”, żeby użytkownik nie czekał na pierwszy cykl.
- Poprawić obsługę zadań anulowanych:
  - jeśli zadanie jest jeszcze `PENDING`, kliknięcie „Zatrzymaj” ma od razu ustawić `CANCELLED`,
  - jeśli zadanie jest `PROCESSING`, ma ustawić `cancel_requested`, a worker ma zakończyć je po aktualnym produkcie.
- Dodać informację w UI, gdy trwa zatrzymywanie, zamiast wyglądać jak brak reakcji.

### 2. Usprawnić worker, żeby nie wisiał bez końca
- Ograniczyć czas pojedynczego kroku AI / weryfikacji, żeby jeden produkt nie blokował całej kolejki.
- Przy generowaniu złotych rekordów pominąć ciężką weryfikację zdjęć jako domyślny krok bulk-generacji; zostawić ją jako osobną funkcję/weryfikację tam, gdzie jest potrzebna.
- Zachować zapisywanie błędów per produkt, żeby jeden problematyczny produkt nie blokował reszty.

### 3. Poprawić styl opisów
- Zmienić prompt generowania w obu ścieżkach:
  - pojedyncze generowanie produktu,
  - generowanie bulk przez worker.
- Nowe zasady opisu:
  - język naturalny, rzeczowy, katalogowy,
  - bez marketingowych fraz typu „idealny wybór”, „doskonały”, „zaprojektowany z myślą”, „sprawdzi się w każdej sytuacji”,
  - bez sztucznych wstępów i pustych ogólników,
  - krótszy, konkretny opis oparty wyłącznie na danych ze źródeł,
  - cechy techniczne nadal jako osobna lista.

### 4. Posprzątać aktualnie zawieszone zadania
- Po zmianach oznaczyć stare anulowane/puste zadania jako zakończone albo sprawić, że nowy worker sam je domknie.
- Dzięki temu przycisk generowania nie będzie blokowany przez stare zadanie.

### 5. Weryfikacja
- Sprawdzić w bazie, czy nowe zadanie przechodzi z `PENDING` do `PROCESSING` i zwiększa `processed_count`.
- Sprawdzić, czy „Zatrzymaj” zmienia stan na `CANCELLED`.
- Sprawdzić przykładowy wygenerowany opis pod kątem mniej sztucznego stylu.

## Pliki do zmiany
- `src/routes/api/public/hooks/process-bulk-jobs.ts`
- `src/lib/pim/bulk-jobs.functions.ts`
- `src/lib/pim/_workers.server.ts`
- `src/lib/pim/ai.functions.ts`
- `src/routes/_auth/projects.$id.index.tsx`
- ewentualnie migracja bazy, jeśli trzeba dodać harmonogram uruchamiania workera.