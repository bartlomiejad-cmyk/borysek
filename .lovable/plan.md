## Cel
Zredukować zużycie tokenów Firecrawl + AI Gateway w `runFirecrawlDiscovery` o ~60-70% bez utraty jakości.

## Zmiany (jeden plik: `src/lib/pim/_workers.server.ts`)

### 1. Dedup po hoście + mniej scrape'ów
Po `filtered = allUrls.filter(...)` dodać deduplikację — max **1 URL na hosta** (pierwszy w kolejności), a następnie `.slice(0, 5)` zamiast `.slice(0, 10)`.

```ts
const seenHosts = new Set<string>();
const filtered = allUrls
  .filter((u) => !isMarketplaceUrl(u, extraBlacklist))
  .filter((u) => {
    const h = (() => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } })();
    if (!h || seenHosts.has(h)) return false;
    seenHosts.add(h);
    return true;
  })
  .slice(0, 5);
```

### 2. Cache URL → pomiń scrape, jeśli istnieje świeży `product_sources`
Przed pętlą scrape'ującą jednym zapytaniem pobrać `product_sources` (tego projektu) dla `filtered` URL-i zaktualizowane w ciągu ostatnich **24h**. Dla trafień: pominąć `firecrawl.scrape` + AI, tylko `upsert` linku do bieżącego produktu (jeśli trzeba) i `emit` info „cache hit".

### 3. Early-exit po 3 dobrych trafieniach
Licznik `goodHits` — inkrementowany gdy `filteredData.is_product_page === true` i `filteredData.imageUrls.length > 0`. Gdy `goodHits >= 3` — `break` z pętli (emit info).

### 4. Skrócić wejście do AI
W `filterScrapedForProduct`:
- `pageMarkdown.slice(0, 6000)` → `pageMarkdown.slice(0, 3500)`.
- `candidateImages` przed wysłaniem do promptu: `.slice(0, 20)` (zabezpieczenie, normalnie i tak ≤12).

### 5. Naprawić niespójny komentarz
Komentarz „top 3" przy `.slice(0, 10)` → zaktualizować na realny limit (5 po dedup).

## Co NIE zmienia się
- `firecrawl.search` `limit: 10`, `location: "Poland"` — bez zmian.
- `firecrawl.scrape` `formats: ["markdown", "rawHtml"]` — bez zmian (rawHtml jest potrzebny do `pickImagesFromScrape` i NIE jest wysyłany do AI).
- `pickImagesFromScrape`, `sanitizeProductDescription`, model AI — bez zmian.
- Schema bazy, RLS, inne workery — bez zmian.

## Weryfikacja
- Uruchomić discovery dla 1 produktu z dobrze pokrytą nazwą → w logach `bulk_job_events` widoczne: „N wyników, M po filtrze" (M ≤ 5, unikalne hosty), ewentualnie „cache hit" lub „early-exit po 3 trafieniach".
- Ponowne uruchomienie dla tego samego produktu w ciągu 24h → wszystkie URL-e cache hit, zero wywołań Firecrawl/AI.
- Porównać liczbę wywołań Firecrawl per produkt: przed ~10, po ≤5 (lub 0 przy cache).
