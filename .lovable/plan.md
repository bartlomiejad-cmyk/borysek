# Cel
Po scrape'owaniu strony przez Firecrawl AI ma od razu odsiać śmieci i zostawić **tylko dane dotyczące konkretnego produktu** (po nazwie/EAN/kodzie):
- zdjęcia faktycznie przedstawiające ten produkt,
- fragment opisu wyłącznie o tym produkcie,
- cechy techniczne tego produktu.

Wszystko inne (banery, ikony, logo sklepu, "zobacz też", recenzje innych produktów, opisy dostawy, regulaminy itp.) **nie trafia** do bazy i tym samym nie pojawia się w UI ani w eksporcie.

## Gdzie wpiąć
Plik: `src/lib/pim/_workers.server.ts`, funkcja `runFirecrawlDiscovery` — krok 4 (pętla `for (const url of filtered)`), zaraz po `firecrawl.scrape(...)`, **przed** `upsert` do `product_sources`.

Dziś zapisujemy:
- `description` = `scrape.markdown.slice(0, 8000)` (cała strona)
- `images` = `pickImagesFromScrape(...)` (do 12 URL-i, też ikonki/banery)

Po zmianie zapis idzie przez nowy filtr AI.

## Co dodać

### 1. Nowa funkcja `filterScrapedForProduct(...)` w `_workers.server.ts`
Wejście:
- `product`: `{ nazwa, kod, ean }`
- `pageMarkdown`: surowy markdown ze scrape
- `candidateImages`: lista URL-i z `pickImagesFromScrape`
- `pageTitle`, `url`

Działanie (1 wywołanie AI Gateway, `google/gemini-2.5-flash`, `response_format: json_object`):
- system prompt: "Zwróć tylko dane dotyczące dokładnie tego produktu. Pomiń banery, polecane, recenzje, dostawę, regulaminy, inne warianty/inne produkty."
- user content: nazwa/EAN/kod produktu + tytuł strony + skrócony markdown (max ~6k zn.) + ponumerowana lista URL-i obrazków
- response schema (Zod):
```
{
  is_product_page: boolean,             // jeśli false – cała strona idzie do kosza
  product_description: string,          // max 4000 zn., tylko o tym produkcie
  product_features: [{key, value}],     // max 60
  product_image_indexes: number[],      // 1-based, tylko zdjęcia przedstawiające produkt
  rejected_reason?: string
}
```
- mapowanie indexów → URL-e (tylko te z listy wejściowej)
- fallback przy błędzie AI: zapis jak dziś (zachowawczo, żeby nie tracić danych) + warn event

### 2. Zmiana w `runFirecrawlDiscovery`
W pętli scrape'a:
```
const filteredData = await filterScrapedForProduct(apiKey, product, scrape, candidateImages, url);

if (!filteredData.is_product_page) {
  emit warn: "strona nie dotyczy tego produktu – pominięto"
  continue;       // nic nie zapisujemy do product_sources
}

upsert product_sources z:
  description: filteredData.product_description
  images:      filteredData.product_image_urls
  raw: {
    source: "firecrawl",
    metadata,
    ai_filter: { features: filteredData.product_features, rejected: candidateImages.filter(...) }
  }
```

Cechy lądują w `raw.ai_filter.features` (nie ruszamy schematu `product_sources`). Generator goldena (`runGenerateGoldenRecord`) już dziś robi własne `features` z opisów źródeł — dostanie cleaner wsad, więc będzie celniejszy.

### 3. Eventy live‑log
W tej samej pętli emitować do `bulk_job_events`:
- `info`  "🧠 <host> — filtruję dane pod produkt"
- `success` "   ✓ <host> — opis OK, X/Y zdjęć produktu, Z cech"
- `warn`  "   ⚠️ <host> — strona nie dotyczy produktu (powód: …) — pominięto"
- `error` przy wyjątku AI

### 4. Bez zmian schematu DB
Nie ruszamy tabel — wystarczą pola, które już istnieją (`product_sources.images`, `description`, `raw`). Brak migracji.

## Co dostanie użytkownik
- W szczegółach produktu i na liście pojawią się **tylko zdjęcia przedstawiające produkt** — bez ikon serwisu, banerów promocyjnych, "polecanych".
- Opis źródła to **wycięty fragment dotyczący tego produktu**, nie cała strona.
- Generator opisu (golden) pracuje na czystszych źródłach → mniej halucynacji i marketingowego szumu.
- Strony, które tak naprawdę nie sprzedają tego produktu (np. trafiony błędnie listing kategorii), zostaną odrzucone i nie zaśmiecą widoku.

## Pliki
- `src/lib/pim/_workers.server.ts` — nowa funkcja `filterScrapedForProduct` + zmiana w `runFirecrawlDiscovery`.
- (opcjonalnie później) widoczny w UI badge "filtr AI: X/Y zdjęć" w karcie źródła — do osobnej iteracji.

## Uwagi / koszty
- +1 wywołanie AI per scrape'owana strona (czyli max 3 na produkt). Model `gemini-2.5-flash` — tani i szybki.
- Trzeba **opublikować** po wdrożeniu, bo cron uderza w published URL.
- Nie ruszamy istniejącego flow `runVerifySources` (drugi pass na zdjęciach pod kątem znaków wodnych / mismatchu) — uzupełnia się, nie kłóci.
