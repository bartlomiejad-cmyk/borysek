## Cel
Dla każdego produktu z `source_products` Firecrawl wyszukuje 5 wyników, odfiltrowuje marketplace'y (Amazon, Allegro, eBay, OLX, Ceneo, AliExpress itp.), wybiera 3 najlepsze sklepy, scrapuje je i zapisuje do `search_results` + `product_sources` — gotowe pod dalszą generację złotych rekordów. Wszystko jako bulk job w tle (jak `GENERATE_GOLDEN`), z postępem i przyciskiem Zatrzymaj.

## Krok 1 — Connector Firecrawl
- Podłączyć connector Firecrawl (`standard_connectors--connect`), żeby `FIRECRAWL_API_KEY` był w `process.env` po stronie serwera.

## Krok 2 — Nowy typ bulk job
- Rozszerzyć enum `bulk_job_kind` o `FIRECRAWL_DISCOVERY` (migracja).
- `bulk_jobs.items` będzie zawierał listę `source_product_id` do przetworzenia.

## Krok 3 — Worker discovery
Nowa funkcja `runFirecrawlDiscovery(sourceProductId)` w `src/lib/pim/_workers.server.ts`:
1. Pobiera produkt (nazwa, kod, EAN).
2. Buduje query: `"{nazwa} {kod}"` (fallback samo `nazwa` lub EAN).
3. `firecrawl.search(query, { limit: 5, lang: "pl", country: "pl" })` przez SDK `@mendable/firecrawl-js`.
4. Zapisuje surowe URL-e do `search_results` (term + organic_urls).
5. Filtr czarnej listy domen marketplace + domeny z `projects.blacklist`:
   - twarda blacklist: `amazon.*, allegro.pl, ebay.*, aliexpress.*, olx.pl, ceneo.pl, skapiec.pl, nokaut.pl, empik.com, morele.net listings`, fora, blogi (heurystyka po ścieżce `/forum/`, `/blog/`).
6. Z pozostałych bierze 3 pierwsze (kolejność z Firecrawl = relevancja).
7. Dla każdego: `firecrawl.scrape(url, { formats: ['markdown'], onlyMainContent: true })` — wyciąga `title`, `description` (markdown skrócony), `images` (z metadata/og:image + obrazów ze scrapa).
8. Upsert do `product_sources` (już istnieje dedup po `project_id,url`).
9. Po sukcesie ustawia `enrichments.status = READY_FOR_GOLDEN` (lub odpowiedni — zgodnie z istniejącym flow matching).

## Krok 4 — Endpoint workerowy
- Rozszerzyć `src/routes/api/public/hooks/process-bulk-jobs.ts` o gałąź `FIRECRAWL_DISCOVERY` → `runFirecrawlDiscovery`.
- Cron już jest (1 min), kickstart z `createBulkJob` też.
- Budżet 25s — discovery na produkt to ~1 search + 3 scrape'y; przy timeoucie kończymy iterację jak dziś.

## Krok 5 — Server function startowa
`startFirecrawlDiscovery({ projectId, sourceProductIds? })` w nowym `src/lib/pim/firecrawl.functions.ts`:
- Jeśli brak `sourceProductIds` — bierze wszystkie produkty projektu bez `product_sources` (lub wszystkie — checkbox w UI).
- Tworzy `bulk_job` typu `FIRECRAWL_DISCOVERY` przez `createBulkJob`.

## Krok 6 — UI
W `src/routes/_auth/projects.$id.index.tsx` obok przycisku „Generuj złote rekordy":
- Nowy przycisk **„Wyszukaj źródła (Firecrawl)"** z dialogiem: opcje „tylko produkty bez źródeł" / „wszystkie", potwierdzenie.
- Pasek postępu identyczny jak dla `GENERATE_GOLDEN` (czyta `bulk_jobs` po `kind = FIRECRAWL_DISCOVERY`), z przyciskiem Zatrzymaj.

## Krok 7 — Konfiguracja blacklisty
- Zaszyta lista marketplace'ów w `src/lib/pim/firecrawl.functions.ts` jako stała `MARKETPLACE_DOMAINS`.
- Uzupełniana o `projects.blacklist` (już istnieje w schemacie).

## Pliki
- migracja: dodanie `FIRECRAWL_DISCOVERY` do enuma `bulk_job_kind`
- nowy: `src/lib/pim/firecrawl.functions.ts` (server fn + helper scrape/filter)
- edycja: `src/lib/pim/_workers.server.ts` — `runFirecrawlDiscovery`
- edycja: `src/routes/api/public/hooks/process-bulk-jobs.ts` — nowa gałąź
- edycja: `src/routes/_auth/projects.$id.index.tsx` — przycisk + postęp
- nowy: `src/components/pim/FirecrawlDiscoveryDialog.tsx`

## Weryfikacja
- Po starcie sprawdzić w bazie: `bulk_jobs` przechodzi PENDING→PROCESSING, `search_results` rosną, `product_sources` rosną o ~3 na produkt, żadnych URL-i z marketplace'ów.
- Test przyciskiem Zatrzymaj na działającym jobie.
