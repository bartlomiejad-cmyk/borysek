## Problem

Po zaimportowaniu produktów okazuje się, że któraś kolumna źródłowa (np. `kod`/symbol) nie została zmapowana w ustawieniach projektu — w bazie jest `null`. Obecnie jedyny sposób to wyczyścić produkty i zaimportować od nowa, co kasuje też wszystkie wyniki AI, regeneracje i ukryte zdjęcia.

## Rozwiązanie

Dodaję funkcję **„Uzupełnij dane z CSV"** dostępną w widoku projektu obok obecnego uploadu źródła. Pozwala dograć/poprawić wartości pól (`kod`, `ean`, `nazwa`, `ext_id`) dla już istniejących `source_products` bez kasowania niczego innego.

### Flow w UI

1. Nowy przycisk **„Uzupełnij dane z CSV"** w sekcji uploadów (osobno od „Wgraj produkty").
2. Po wybraniu pliku otwiera się dialog:
   - **Kolumna klucza** (select po nagłówkach CSV) — po czym dopasować wiersz do istniejącego produktu.
   - **Pole klucza w bazie**: `ext_id` / `ean` / `kod` / `nazwa`.
   - **Mapowanie**: dla każdego pola docelowego (`ext_id`, `nazwa`, `kod`, `ean`) wybór kolumny CSV (lub „— pomiń —"). Domyślnie podpowiadam te z konfiguracji projektu.
   - Checkbox **„Nadpisuj istniejące wartości"** (domyślnie OFF — wypełnia tylko puste pola, żeby nie zepsuć już dobrych danych).
3. Po „Zastosuj" pokazuje podsumowanie: dopasowanych X, niedopasowanych Y, zmienionych Z.

### Backend — nowy server function

`updateSourceProductsFromCsv` w `src/lib/pim/ingest.functions.ts`:

- Input: `projectId`, `keyField` (`ext_id|ean|kod|nazwa`), `rows: Array<{ key: string; ext_id?: string|null; nazwa?: string|null; kod?: string|null; ean?: string|null }>`, `overwrite: boolean`.
- Pobiera `source_products` projektu (id + 4 pola klucza).
- Buduje mapę `key → product.id` po wybranym polu (normalizacja: trim, lowercase dla nazwy; trim dla pozostałych).
- Dla każdego wiersza CSV: znajduje produkt, składa patch — przy `overwrite=false` ustawia tylko te pola, w których aktualna wartość jest `null`/pusta.
- Wykonuje update'y w batchach (po 200, `update().eq("id", ...)` per produkt — proste i bezpieczne; ilości są rzędu setek/tysięcy).
- Zwraca `{ matched, unmatched, updated, skipped }`.
- **Nie tyka** `enrichments`, `product_sources`, `search_results` — cała praca AI i scrapingu zostaje.

### Frontend

- Rozszerzam `parseCsv` (lub dodaję wariant `parseCsvRaw`) o tryb zwracający surowe nagłówki + wiersze jako `Record<string,string>` — potrzebne do dialogu mapowania.
- Nowy komponent `RemapCsvDialog.tsx` (select klucza + 4 selecty mapowania + checkbox + przycisk).
- Po sukcesie: `qc.invalidateQueries(["project", id])` + `refetchProducts()` + toast z podsumowaniem.

### Co świadomie pomijam

- Nie ruszam mechanizmu matchingu (`runMatching`) — jeżeli użytkownik chce ponownie dopasować źródła po zmianie EAN/nazwy, robi to istniejącym przyciskiem „Dopasuj".
- Nie zmieniam schematu bazy.
- Nie dodaję edycji pojedynczego produktu w UI (osobny temat, jeśli będzie potrzeba).

## Pliki do zmiany

- `src/lib/pim/ingest.functions.ts` — nowy serverFn `updateSourceProductsFromCsv`.
- `src/lib/pim/parsers.ts` — pomocnik do parsowania CSV ze zwrotem `{ headers, rows }`.
- `src/components/pim/RemapCsvDialog.tsx` — nowy komponent dialogu.
- `src/routes/_auth/projects.$id.index.tsx` — przycisk w sekcji uploadów + podpięcie dialogu.
