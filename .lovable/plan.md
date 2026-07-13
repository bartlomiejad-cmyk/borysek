## Cel
Przy imporcie CSV, jeśli w pliku są kolumny z URL-ami zdjęć (główne + galeria), zapisać te URL-e bezpośrednio przy produktach i oznaczyć produkt jako „ma zdjęcia z importu" — dziś dialog ma już mapowanie tych kolumn, ale worker jedynie ustawia sentinel `__imported__` i wyrzuca same linki.

## Zmiany

### 1. `src/lib/pim/parsers.ts`
- Dodać do `CsvRow` opcjonalne `main_image_url: string | null` i `gallery_urls: string[]`.
- W `buildCsvRowsFromMapping` wyekstrahować URL-e z kolumn `main_image_column` (pojedynczy URL) i `gallery_column` (split po `,`, `|`, nowej linii, tab; filter `^https?://`). `main_image_url` fallback: pierwszy z galerii, jeśli brak dedykowanej kolumny.
- `has_images` = wynik z nowej ekstrakcji (ma sens tylko gdy faktycznie znaleziono URL).

### 2. `src/lib/pim/ingest.functions.ts` — `ingestSourceProducts`
- Rozszerzyć `sourceProductSchema` o `main_image_url: z.string().nullable().optional()` i `gallery_urls: z.array(z.string()).optional()`.
- Przy insercie do `source_products` te pola idą tylko przez `raw` (bez zmian w tabeli).
- Zbudować mapę `naturalKey → { main, gallery }`. Dla wstawionych produktów, gdzie znaleziono URL-e, jednym `update`em na enrichment ustawić:
  - `pinned_main_url` = `main_image_url` (jeśli jest),
  - `ai_gallery_urls` = zdeduplikowana lista (main + gallery),
  - `regenerated_main_image = '__imported__'` (zachować sentinel dla filtra „Ma zdjęcia").
- Zamiast dotychczasowego `withImages` opartego wyłącznie o `has_images`, użyć nowej mapy URL-i (te same klucze).

### 3. Bez migracji DB
Używamy istniejących kolumn `enrichments.pinned_main_url` i `ai_gallery_urls`, więc lista produktów, filtr „Bez zdjęć", karta produktu i podgląd automatycznie zobaczą te obrazy (już czytają te pola).

### 4. Weryfikacja
- Import CSV z kolumnami zdjęć → wiersze na liście pokazują miniatury (pinned + galeria) od razu, badge „ma zdjęcia" aktywne.
- Import CSV bez kolumn zdjęć → zachowanie bez zmian.
- Filtr „Bez zdjęć" nadal działa (sentinel `__imported__` obecny gdy są URL-e; brak sentinela = do uzupełnienia).

## Poza zakresem
- Bez pobierania/rehostowania zdjęć — trzymamy URL-e źródłowe (tak jak dziś przy scrapingu).
- Bez zmian w `RemapCsvDialog` (uzupełnianie kolumn tekstowych) — dograwanie zdjęć do już istniejących produktów można dodać osobno, jeśli będzie potrzebne.