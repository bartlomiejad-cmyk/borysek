
# Import produktów z wklejonych linków

Dodaje drugi tryb dodawania produktów do projektu PIM: użytkownik wkleja listę URL-i (jeden na linię), Firecrawl scrapuje każdą stronę, AI wyciąga pola produktowe (nazwa, kod, EAN, opis, obrazy), tworzone są rekordy w `source_products`, `product_sources` i `search_results` — reszta pipeline'u (Match, Generuj złote) uruchamiana ręcznie tak jak dziś.

## UI

- Obok obecnego przycisku „Wgraj CSV" w `src/routes/_auth/projects.$id.index.tsx` dodać przycisk **„Dodaj z linków"**.
- Nowy komponent `src/components/pim/ImportUrlsDialog.tsx`:
  - `Textarea` (do ~200 URL-i, jeden na linię), licznik wklejonych/prawidłowych linków, walidacja `new URL()`, deduplikacja.
  - Podgląd listy z per-URL statusem (`pending / scraping / extracting / ok / error`) i komunikatem błędu.
  - Przyciski **Anuluj** / **Importuj**. Sticky footer, layout jak w naprawionym `ImportCsvDialog`.
  - Pasek postępu (X z N).

## Backend (server function)

Nowy plik `src/lib/pim/import-urls.functions.ts` — jedna funkcja `importProductsFromUrls` (`createServerFn` + `requireSupabaseAuth`), wejście: `{ projectId, urls: string[] }`. Dla każdego URL synchronicznie (max ~10 równolegle, batchowane po 5 przez `Promise.all`, całość opakowana w limity by nie przekroczyć budżetu czasu Workera — jeśli lista > ~40 URL, rozbić na kolejne wywołania z frontu z paginacją):

1. **Firecrawl scrape** — użyć istniejącego SDK/klienta (jak w `_workers.server.ts` przy discovery). Formaty: `markdown`, `rawHtml`, `links`. Przefiltrować `rawHtml` przez istniejące `stripRelatedProductBlocks` / `stripRelatedHeadingSections` (już są w `_workers.server.ts` — wyeksportować lub przenieść do współdzielonego helpera).
2. **Ekstrakcja pól produktowych** — wywołanie Lovable AI Gateway (`openai/gpt-5.5`) z Zod schema:
   ```
   { nazwa, kod, ean, description, product_features (Record<string,string>), main_image_url, gallery_urls }
   ```
   Input: focused markdown (`extractDescriptionSection` z `source-cleanup.ts`) + JSON-LD z rawHtml (parse `<script type="application/ld+json">` → `Product` schema jako hint dla AI).
   System prompt: identyczne reguły jak w istniejącym `filterScrapedForProduct` (odrzucaj chrome sklepu, tłumacz EN→PL, zachowaj dane techniczne).
3. **Obrazki** — użyć `pickImagesFromScrape` / `filterImageUrls` na wyfiltrowanym HTML, jak w istniejącym pipeline.
4. **Zapis w bazie** (w jednej transakcji per URL):
   - `source_products` — `insert` z `nazwa/kod/ean/ext_id=null/has_images` z `raw = { imported_from_url: url }`.
   - `product_sources` — `upsert` (`onConflict: project_id,url`) z pełnym scrape'em (title, description, images, extra_images, raw).
   - `search_results` — `insert` wiersz z `term = nazwa` i `organic_urls = [url]` (dzięki temu późniejsze `runMatching` od razu połączy nowe źródło z produktem).
   - `enrichments` — `upsert` (`onConflict: source_product_id`) z `status='PENDING', match_type='NO_MATCH'`, identycznie jak w `ingestSourceProducts`.
5. Zwraca `{ ok: [{url, sourceProductId, name}], failed: [{url, error}] }`.

## Reużycie istniejącego kodu

- Wyciągnąć wspólne helpery do `src/lib/pim/scrape-shared.server.ts`: `stripRelatedProductBlocks`, `stripRelatedHeadingSections`, `pickImagesFromScrape`, `parseJsonLdProduct` (nowy) — zaimportować z `_workers.server.ts` (bez duplikacji, refaktor tylko re-export).
- Prompt ekstrakcji: nowy stały prompt osadzony w `import-urls.functions.ts` (mocno wzorowany na `filterScrapedForProduct`, ale z wymogiem zwrócenia `nazwa/kod/ean` z heurystykami: EAN = ciąg 8/12/13 cyfr, kod = SKU/MPN z JSON-LD lub sekcji „Product code/SKU").

## Flow

- Zgodnie z odpowiedzią użytkownika: **żadnego auto-pipeline'u**. Po zakończeniu importu dialog pokazuje „Zaimportowano X produktów, Y błędów" i toast z podpowiedzią: „Kliknij **Dopasuj** aby powiązać źródła i **Generuj złote** aby uzupełnić dane".

## Uwagi techniczne

- Cloudflare Worker timeout 30s: 200 URL-i × Firecrawl+AI to zbyt dużo synchronicznie. Front będzie wysyłał w paczkach po 10 URL-i sekwencyjnie i aktualizował UI. Alternatywnie (jeśli okaże się wolne) w kolejnej turze przeniesiemy to na `bulk_jobs` (kind: `URL_IMPORT`) — na razie zaczynamy od trybu synchronicznego z paczkowaniem, bo user chce widzieć wyniki od razu.
- Walidacja URL po stronie serwera (Zod `.url()`), blacklist marketplace'ów **wyłączona** (user świadomie wkleja linki, może to być np. producent).
- Bez zmian w schemacie DB.

## Pliki

- `src/lib/pim/import-urls.functions.ts` — nowa server function.
- `src/lib/pim/scrape-shared.server.ts` — nowe (wyekstrahowane helpery z `_workers.server.ts`).
- `src/lib/pim/_workers.server.ts` — usunąć zduplikowane helpery, importować z shared.
- `src/components/pim/ImportUrlsDialog.tsx` — nowy dialog.
- `src/routes/_auth/projects.$id.index.tsx` — nowy przycisk „Dodaj z linków" obok „Wgraj CSV".
