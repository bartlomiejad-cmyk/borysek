## Problem

`pickImagesFromScrape` (`src/lib/pim/_workers.server.ts`) zwraca URL-e z `srcset`/`<img src>` bez rzetelnej normalizacji do wersji full-size. Efekt: przy imporcie z linków (np. speed-line.com) do galerii trafiają miniatury zamiast pełnych zdjęć. Funkcja `upgradeToLargeImageUrl` pokrywa tylko część platform (WooCommerce, Shopify, Magento, PrestaShop, IdoSell/Shoper, Google CDN); brakuje typowych wzorców takich jak:

- `/thumbnail/`, `/thumbs/`, `/tiny/`, `/xs/`, `/small/`, `/preview/`, `/resized/…`
- IdoSell v2: `/_data/products/…-1_360.jpg` / `-1_100.jpg` → `-1.jpg`
- Speedline/Presta warianty: `-cart_default`, `-home_default`, `-thickbox_default` (już mamy) ale też `-small`, `_100x100`, `_thumb`
- ogólne query-size: `?w=…&h=…`, `?size=…`, `?width=…`
- CDN-y typu Cloudinary (`/w_200,h_200,c_…/`), Imgix (`?w=…&fit=…`), TinyMCE / Storyblok (`/f/…/…x…/`)

Dodatkowo:

- Z `srcset` bierzemy „największy widoczny wariant", ale wciąż często nie ma tam pełnego oryginału — pełny bywa jedynie w `<a href>` galerii lub w JSON-LD (`image`, `image[0]`, `offers.image`).
- Ignorujemy `metadata.ogImage` i `metadata.jsonLd` — a to w wielu sklepach jedyne miejsce z pełnym plikiem.
- Nie zbieramy `<link rel="preload" as="image">` ani atrybutów `data-flickity-lazyload`, `data-lazy`, `data-lazy-src`, `data-srcset`.

## Zmiany

Wszystko dzieje się w warstwie ekstrakcji obrazów — bez dotykania promptów AI, generowania miniaturek FAL, ani UI.

### 1. `src/lib/pim/_workers.server.ts` — `upgradeToLargeImageUrl`

Rozszerzyć o dodatkowe wzorce:

- Ogólne segmenty w ścieżce: `/thumbnail/`, `/thumbs/`, `/tiny/`, `/preview/`, `/resized/`, `/scaled/`, `/xs/`, `/xxs/`, `/w200/`, `/w300/`, `/h200/`, `/mini/`, `/miniatures/`, `/miniatury/` → usunąć segment lub zamienić na `/source/` (z zachowaniem reszty ścieżki).
- IdoSell v2: `-1_100.jpg`, `-1_360.jpg`, `_100.jpg`, `_360.jpg` → wersja bez sufiksu.
- PrestaShop: dodać `-small`, `-cart`, `-home` bez `_default`, oraz `-thickbox` bez `_default`.
- Query-size: dla parametrów `w`, `width`, `h`, `height`, `size`, `s`, `maxw`, `maxh`, `imwidth`, `imheight` — usunąć je z URL-a, żeby dostać oryginał (a jeśli CDN wymaga rozmiaru, ustawić `2048`).
- Cloudinary: `/upload/w_\d+,h_\d+,c_[^/]+/` → `/upload/`.
- Imgix / Sanity / Storyblok: usunąć `?w=…&h=…&fit=…` z query.
- Sufiks `-thumb`, `-thumbnail`, `-mini`, `-tiny`, `-xs`, `-preview` przed rozszerzeniem → wyciąć.

### 2. `src/lib/pim/_workers.server.ts` — `pickImagesFromScrape`

- Rozszerzyć listę `dataAttrs` o: `data-srcset`, `data-lazy-src`, `data-lazy`, `data-lazy-srcset`, `data-flickity-lazyload`, `data-flickity-lazyload-src`, `data-thumb-large`, `data-photoswipe-src`, `data-fancybox-href`, `data-mfp-src`, `data-image-large`, `data-image-src`, `data-hires-src`.
- Dodać ekstrakcję `<link rel="preload" as="image" href="…">` z HTML — zwykle wskazuje na kluczowe zdjęcie hero w pełnym rozmiarze.
- Dodać ekstrakcję z JSON-LD (`<script type="application/ld+json">…</script>`): pola `image`, `image.url`, `image[0]`, `offers.image`, `hasVariant.image`. Wpuścić przez `push()` (czyli automatyczny `upgradeToLargeImageUrl` + walidacja min. wymiaru).
- Jeśli `res.metadata.ogImage` (lub `metadata.og:image`) prowadzi do pliku produktu (test `looksLikeProductPath` lub domena zgodna z sourceURL), dodać go do puli — nadal przechodzi przez upgrade i junk-filter.
- Dla `srcset` — zamiast brać po prostu największy zadeklarowany `w`, po wybraniu spróbować dodatkowo puścić przez `upgradeToLargeImageUrl`; jeśli po upgradzie URL się zmienia w URL wskazujący jeszcze większą wersję (np. usunęliśmy `_100x100`), preferować wynik.
- Przy deduplikacji, jeśli dwa URL-e różnią się tylko rozmiarem po normalizacji, zostaw jeden po `upgrade` (obecnie działa, bo `push` wywołuje upgrade — potwierdzić, że dodane źródła też przez to przechodzą).

### 3. `inferMinDimensionFromUrl`

- Uodpornić na false-negatives: nie odrzucać URL-a jako „za małe", jeśli po `upgradeToLargeImageUrl` nadal jest widoczny rozmiar < 400 — spróbować drugiego upgrade'u; jeśli wciąż < 400, dopiero wtedy odrzucić.

### 4. Bez zmian w UI

Nie ruszamy `ImportUrlsDialog`, edytora produktu, list `Wybrane zdjęcia`, ani logiki FAL. To wyłącznie poprawa ekstrakcji URL-i po stronie scrapera/workera — działa tak samo dla importu z linków (`import-urls.functions.ts`) i głównego Firecrawl discovery.

## Weryfikacja

- Po zmianach zaimportować ponownie przykładowy produkt ze speed-line.com i sprawdzić, czy URL-e w `enrichments.source_products[*].images[*]` nie zawierają segmentów `thumbnail`, `home_default`, `_100x100` itd.
- Ręcznie przetestować `upgradeToLargeImageUrl` na kilku znanych wzorcach jednostkowo (log w `import-urls` już drukuje URL-e do konsoli — wystarczy przejrzeć wynik na produkcie z uploadu obok).
