## Problem

Do listy kandydatów zdjęć wpadają obrazki z sekcji „See more NORMA products / Related / Polecane / Klienci kupili" (zdjęcie #38). `pickImagesFromScrape` w `src/lib/pim/_workers.server.ts` przeszukuje **cały `rawHtml`** (lightbox anchors, `data-zoom-*`, `srcset`, `<img>` z `/product/` w ścieżce) — a karuzele „related" spełniają wszystkie te warunki (te same URL-e katalogowe, ten sam kształt HTML co główna galeria). AI-filter (`filterScrapedForProduct`) dostaje je jako kandydatów i część przepuszcza, bo wizualnie to prawdziwe produkty tej samej marki.

Rozwiązanie: **wyciąć sekcje „related" z HTML zanim uruchomimy ekstrakcję zdjęć**. To robota deterministyczna, tania i nie wymaga zmian w AI.

## Zmiany

### 1) `src/lib/pim/_workers.server.ts` — nowa funkcja `stripRelatedProductBlocks(html)`

Wywoływana wewnątrz `pickImagesFromScrape` na `html` przed czterema regexami ekstrakcji. Wycina:

- **Kontenery z klasą/id `related`, `cross-sell`, `upsell`, `you-may-also-like`, `also-bought`, `recommend*`, `similar*`, `see-more`, `more-products`, `carousel-related`, `product-suggestions`, `polecane`, `podobne`, `klienci-kupili`, `zobacz-tez`** — dopasowanie po `class="..."` i `id="..."` na `<section>`, `<div>`, `<aside>`, `<ul>`. Wycinamy cały element razem z zawartością (regex balansujący po tagu; jeśli zagnieżdżony — bierzemy najbliższe zamknięcie tego samego tagu na tym samym poziomie).
- **Sekcje po nagłówku**: wszystko między nagłówkiem `<h1..h6>` zawierającym frazy `see more`, `related`, `you may also like`, `customers also bought`, `polecane`, `podobne produkty`, `klienci kupili`, `zobacz też`, `więcej produktów`, `more from`, `similar products` — a następnym nagłówkiem tego samego lub wyższego poziomu (albo końcem `<main>`).
- **Slick/Swiper karuzele oznaczone jako related**: elementy z klasami `swiper-*` / `slick-*` łączonymi z tokenami powyżej (np. `related-swiper`, `swiper-related`).

Zwraca „okrojony" HTML. Nie dotykamy głównej galerii produktu (te elementy nie zawierają tokenów `related/polecane/…`).

### 2) `pickImagesFromScrape` — użyj oczyszczonego HTML

```ts
const html = ...;
const cleanHtml = html ? stripRelatedProductBlocks(html) : "";
if (cleanHtml) { /* obecna pętla 1)–4) na cleanHtml */ }
```

### 3) Markdown fallback: analogicznie w `extractDescriptionSection` już wycinamy sekcje `## Related` / `## You may also like` / `## Polecane` — bez zmian, ale dorzucamy do listy `SKIP_SECTION_HEADINGS` warianty: `see more`, `more from`, `similar products`, `podobne produkty`, `klienci kupili`, `zobacz też` (w `src/lib/pim/source-cleanup.ts`). To zabezpiecza ścieżkę AI-filtra i sanityzację opisów.

### 4) Wzmocnienie AI-filtra (bezpiecznik, nie główny fix)

W `filterScrapedForProduct` (system prompt) dodać jedno zdanie: „Jeżeli kandydatem zdjęcia jest inny wariant tego samego producenta (inny kaliber / gramatura / model), odrzuć — nawet gdy marka się zgadza. Dopasuj po kodzie / EAN / dokładnym wariancie z produktu klienta."

## Weryfikacja

1. Uruchom „Wyszukaj źródła (Firecrawl)" dla produktu Norma .223 Rem V-MAX 3,2g z projektu ammobrak (albo dowolnego z widocznymi „related" blokami).
2. W `product_sources.images` nie powinno być zdjęć innych wariantów (.30-06, .308, R&T FMJ 6,5 Creedmoor).
3. W logu bulk-joba `filter_stats.rejected_images` powinno spaść (bo obcinamy zanim AI je zobaczy), a `kept_images` — być bliżej rzeczywistej galerii produktu.

## Uwagi techniczne

- Wszystkie zmiany są backend-only, żadnego dotykania UI.
- Regexy działają na `rawHtml`; nie parsujemy DOM (workerd nie ma DOMParsera). Do wycinania kontenerów użyjemy prostego dopasowania zachłannego per-tag z ograniczeniem długości (max 200 kB na blok), żeby uniknąć katastroficznego backtrackingu.
- Nic nie zmieniamy w już zapisanych rekordach; efekt dotyczy nowych scrape'ów. Dla istniejących produktów wystarczy ponownie kliknąć „Wyszukaj źródła".
