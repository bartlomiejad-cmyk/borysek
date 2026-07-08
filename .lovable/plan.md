## Cel

W dialogu importu CSV umożliwić zmapowanie dwóch kolumn ze zdjęciami (główne + galeria). URL-e NIE są zapisywane do bazy — służą wyłącznie do oznaczenia, które produkty mają już zdjęcia, a które są puste. Puste produkty wpadają do istniejącego filtra „Bez zdjęć" i akcji masowej „Uzupełnij zdjęcia" (obsługa ręczna).

## Zmiany

### 1. `src/components/pim/ImportCsvDialog.tsx`
- Dodać dwa nowe pola mapowania w `FIELDS`:
  - `main_image_column` — „Zdjęcie główne (URL)"
  - `gallery_column` — „Wszystkie zdjęcia (URL, separator `,` lub `|`)"
- Po submit: dla każdego wiersza, jeżeli którakolwiek z tych dwóch kolumn zawiera choć jeden niepusty URL — dołączyć flagę `has_images: true` do wiersza wysyłanego do `ingestSourceProducts`. Same URL-e NIE trafiają do payloadu.

### 2. `src/lib/pim/parsers.ts`
- Rozszerzyć `CsvRow` o opcjonalne `has_images?: boolean`.
- Rozszerzyć `ExplicitCsvMapping` o `main_image_column` i `gallery_column`.
- W `buildCsvRowsFromMapping` czytać obie kolumny, splitować galerię po `,` / `|` / whitespace, filtrować po `^https?://`; ustawiać `has_images = true` gdy znajdzie ≥1 URL. Wiersz z samym `has_images` (bez id/nazwa/kod/ean) nadal jest odfiltrowywany (bez zmian w regule).

### 3. `src/lib/pim/ingest.functions.ts`
- W `sourceProductSchema` dodać `has_images: z.boolean().optional()`.
- W handlerze `ingestSourceProducts`: przed wstawieniem odfiltrować `has_images` z payloadu do `source_products` (pole nie istnieje w tabeli). Zebrać mapę `key → has_images` po naturalnym kluczu wiersza (ext_id || ean || kod || lowercased nazwa) tego samego wsadu.
- Po insercie `source_products` i po utworzeniu pending `enrichments`: dla każdego świeżo wstawionego produktu z `has_images === true` zaktualizować odpowiadający enrichment tak, aby był uznany za „ma media" przez istniejące filtry.
  - Najmniej inwazyjnie: `UPDATE enrichments SET regenerated_main_image = '__imported__' WHERE source_product_id = ...`. Sentinel URL (nie-http) nie jest renderowany przez `pickThumbsForList` (regex `^https?://`), ale spełnia warunek `!t.regenerated_main_image` w `FillMissingImagesDialog` i w liście produktów.
  - Jeśli lista produktów w `projects.$id.index.tsx` używa innego warunku niż `regenerated_main_image || ai_gallery_urls.length || thumbnail`, sprawdzić i użyć tam identycznej konwencji.

### 4. Weryfikacja
- `projects.$id.index.tsx`: potwierdzić, że filtr „Bez zdjęć" i przekazywane `FillTarget` dla akcji masowej używają tych samych trzech pól (`regenerated_main_image`, `ai_gallery_urls`, `thumbnail`) — jeśli tak, żadne dodatkowe zmiany nie są potrzebne.

## Poza zakresem

- Backend regen/scrape, worker, edge function — bez zmian.
- Layout dialogu (naprawiony w poprzedniej turze) — bez zmian.
- Brak automatycznego uruchamiania fill po imporcie (użytkownik wybrał tryb ręczny).
- URL-e ze zdjęciami z CSV nie są zapisywane ani wyświetlane; nie pojawią się w widoku produktu ani w eksporcie.
