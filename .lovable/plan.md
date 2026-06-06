## Cel

1. Firecrawl `search` ma jechać z lokalizacją **Polska / język polski** (teraz domyślnie idzie po US — stąd `pbdionisio.com` z Filipin w wynikach).
2. Ze scrape'owanego markdown/HTML mają być pobierane **wyłącznie zdjęcia z galerii produktowej**, najlepiej w wersji powiększonej (po kliknięciu w lightbox/zoom).

## Plan zmian (jeden plik: `src/lib/pim/_workers.server.ts`)

### 1. Lokalizacja PL dla Firecrawl search (linia ~921)

Dorzucamy do `firecrawl.search` parametry geo+language:

```ts
firecrawl.search(query, {
  limit: 10,
  sources: ["web"],
  location: "Poland",
  lang: "pl",
  country: "pl",
})
```

Efekt: wyniki Google'a serwowane z polskiego IP/locale — `pbdionisio.com`, `walmart.com` itp. wypadają z TOP10, zostają polskie sklepy (kaliber.pl, bestgun.pl, militaria, puchacz).

### 2. Gallery-only image extraction (zastępujemy `pickImagesFromScrape`)

Obecnie funkcja zbiera:
- `metadata.ogImage` (zwykle baner / OG share image, NIE galeria)
- `metadata.image`
- KAŻDY `![](...)` z markdown (więc też logo brandu, miniatury polecanych produktów, ikony w stopce)

Nowe podejście — pobieramy `rawHtml` razem z markdown i wyciągamy **tylko** zdjęcia, które wyglądają na produkt z galerii:

a) **Zmiana formatów scrape** (linia ~958):
```ts
firecrawl.scrape(url, {
  formats: ["markdown", "rawHtml"],
  onlyMainContent: true,
})
```

b) **Nowa logika `pickImagesFromScrape(res)`** — priorytety od najmocniejszego sygnału galerii:

   1. **Lightbox / zoom anchor** — z `rawHtml` wyciągamy `<a href="...jpg|jpeg|png|webp">` które zawierają `<img>`. To kanoniczny wzorzec galerii produktowej (klik → powiększenie). `href` to wersja oryginalna/duża.
   2. **Atrybuty data-* na `<img>`**: `data-zoom-image`, `data-large`, `data-large_image`, `data-src-large`, `data-image`, `data-full`, `data-original`, `data-big`. To wersje "po kliknięciu" w sklepach (WooCommerce, PrestaShop, Shoper, Shopify, IdoSell).
   3. **`srcset`** — bierzemy największy wariant (`...1600w` itd.).
   4. **`<img src>`** tylko wtedy, gdy plik jest w katalogu o nazwie sugerującej galerię/produkt (`/product`, `/products`, `/galeria`, `/gallery`, `/media/catalog/product/`, `/zdjecia/`) ORAZ nie zawiera tokenów thumbnail.
   5. **Pomijamy całkowicie**: `metadata.ogImage`, `metadata.image`, markdown `![](...)` poza punktem 4 (są to z reguły logo / banery / polecane produkty, nie galeria).

c) **Upgrade do dużych wersji** — jeśli URL pasuje do typowych wzorców miniatur, podmieniamy na duży wariant zanim zapiszemy:
   - Magento: `/cache/.../small_image/...` → wytnij segment `/cache/<hash>/<type>/` lub podmień `small_image`/`thumbnail` na `image`.
   - WooCommerce: `-150x150.jpg`, `-300x300.jpg`, `-768x768.jpg` → usuń sufiks `-WxH` przed rozszerzeniem.
   - PrestaShop: `-home_default.`, `-cart_default.`, `-small_default.`, `-medium_default.` → `-large_default.`.
   - Shopify CDN: `_small.`, `_compact.`, `_medium.`, `_large.`, `_grande.` → `_2048x2048.` (lub usunąć sufiks rozmiaru).
   - IdoSell/Shoper: `/source/` zamiast `/small/`, `/m/` zamiast `/s/`.

d) **Filtr rozmiaru** — jeśli URL koduje wymiary w nazwie (`_400x400`, `-1200x800`, `_w800`, `=w800`), odrzucamy wszystko < 400px po krótszym boku. Pozostałe (bez wymiarów w URL) przepuszczamy — realny rozmiar i tak weryfikuje istniejący `image-size.server.ts` w dalszym pipeline.

e) **Twardy filtr** — na końcu `filterImageUrls(...)` (już wycina SVG/GIF, logo metod płatności, certyfikaty, sociale) + `.slice(0, 12)`.

f) Jeśli po nowym filtrze zostaje **0 kandydatów** (np. sklep nie używa lightbox/zoom i ładuje tylko `<img src>`), emitujemy `warn` z URL-em — tak będzie wiadomo, że trzeba dopisać kolejny wzorzec, zamiast wracać do brudnego fallbacku.

## Czego NIE zmieniam

- Logika scoringu / AI filter (`filterScrapedForProduct`) — bez zmian.
- Cleanup opisów (`source-cleanup.ts`) — bez zmian.
- Liczba kredytów (search 10, scrape ≤10) — bez zmian.
- UI — żadnych zmian frontendu.

## Weryfikacja

Po wdrożeniu uruchom "Wyszukaj źródła" na tym samym produkcie GIRSAN i sprawdź `bulk_job_events`:
- W logach `🔎 ... szukam` → lista organicznych URL nie powinna zawierać `.com` z USA/Azji, powinny dominować `.pl`.
- W logach `🧠 host — filtruję dane pod produkt (N kandydatów zdjęć)` → N powinno być znacznie mniejsze niż dziś (tylko galeria), a kept_images / candidates ≈ 1.0 (mniej szumu do odrzucenia).
- Wizualnie w UI: kafelki źródeł = ostre, duże zdjęcia produktu (≥1000px) zamiast miniatur 200×200.
