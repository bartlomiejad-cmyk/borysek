## Problem

W projekcie `hurtownia-format` `runFirecrawlDiscovery` zapisuje do `product_sources`:
- opisy zawierające menu sklepu, „Nowości w ofercie", „Zamów do 14:00", „Zadzwoń!", ceny, „Do koszyka", stopkę,
- zdjęcia innych produktów (bloki bestsellery / polecane / kategoria).

`onlyMainContent: true` w Firecrawl czasem nie odcina tego chrome. Sanitizer i AI-filter dostają cały markdown (do 3500 znaków) oraz wszystkie zdjęcia z HTML — dlatego śmieci przechodzą dalej.

## Zakres

Zmiany wyłącznie w:
- `src/lib/pim/_workers.server.ts`
- `src/lib/pim/source-cleanup.ts`

Bez migracji, bez UI, `runMatching` nie ruszamy (scoring TOP 5 już działa).

## Plan

### 1. Izolacja regionu produktu z rawHtml (nowa funkcja `extractProductRegionHtml`)

Wyznaczamy podzbiór HTML, który na pewno dotyczy produktu i tylko na nim pracujemy dalej:

1. JSON-LD `Product` → `name` → najbliższy `<h1>`/`[itemprop=name]` z tą nazwą → przodek pasujący do `main`, `article`, `[itemtype*="Product"]`, `#product`, `.product-page`, `.product-detail`.
2. Fallback: pierwszy `<main>`/`<article>`; potem pierwszy `[itemtype*="Product"]` / `.product`.
3. `stripRelatedProductBlocks` rozszerzone o klasy/ID typowe dla PrestaShop/WooCommerce/IdoSell: `newest-products`, `bestsellers`, `products-list`, `products-grid`, `cross-sell`, `upsell`, `promo`, `sidebar`, `footer`, `header`, `nav`, `menu`.
4. `pickImagesFromScrape` i AI-filter tekstowy pracują na HTML/markdown z tego regionu, nie na całej stronie.

### 2. Twardszy `sanitizeProductDescription`

Nowe wpisy w `DESC_CUT_HEADINGS` i `DESC_BLOCK_PHRASES`:
- odcięcie od pierwszego wystąpienia: `Nowości w ofercie`, `Bestsellery`, `Polecane produkty`, `Zobacz też`, `Klienci kupili`, `Zamów do`, `Wysyłka dzisiaj`, `Darmowa dostawa`, `Masz pytanie`, `Zadzwoń`, `Czekamy na`, `Godziny otwarcia`,
- odrzucenie linii `Do koszyka`, `szt.`, kursywnych cen typu `_7,46 zł_`, markdown-linków obudowanych `\\` (listing kafelków),
- detektor „ściany linków": jeżeli w oknie 8 linii ≥5 to `- [tekst](url)`, cały blok wypada,
- odrzucenie nagłówków markdown zawierających breadcrumb kategorii (np. `# Worki na śmieci LDPE 35l czarne...`) gdy powtarzają tytuł produktu,
- jeżeli po sanityzacji zostaje < 30 znaków tekstu, zwracamy `""` (worker zapisze `description = null`).

### 3. Twardsza selekcja zdjęć

- Kandydaty ze `pickImagesFromScrape` wyłącznie z regionu produktu.
- Jeżeli JSON-LD `Product.image` istnieje — traktujemy je jako jedyne źródło; reszta HTML tylko jako fallback.
- W `filterScrapedForProduct` dodajemy pass wizualny (`google/gemini-2.5-flash`, multimodal): nazwa produktu + top 8 kandydatów jako `image_url`. Wynik AND-ujemy z tekstowym filtrem. Timeout 15s, przy błędzie/braku klucza — zachowanie obecne.

### 4. Diagnostyka

Logi worker'a dostają: rozmiar markdown przed/po ekstrakcji regionu, długość opisu po sanityzacji, ile zdjęć odrzucił każdy krok (region → tekstowy filtr → wizualny filtr).

## Uruchomienie

Klient klika **Wyszukaj źródła (Firecrawl)** w projekcie `hurtownia-format` — nowe reguły działają w momencie scrape'u, więc istniejące `product_sources` trzeba pobrać ponownie. `runMatching` już poprawnie zdegraduje karty bez tytułu/opisu.

## Pytanie kontrolne

Czy włączyć wizualny AI-filter (Gemini vision) — +1 request na źródło, ~1–2 s każde? Domyślnie proponuję **tak**, bo tekstowy filtr sam nie odróżni szczotki od worka na śmieci widocznego w „Nowościach".