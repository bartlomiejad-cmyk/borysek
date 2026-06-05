## Optymalizacja kosztów Firecrawl

Cel: zmniejszyć liczbę tokenów/kredytów zużywanych przez `runFirecrawlDiscovery` w `src/lib/pim/_workers.server.ts`, bez zmiany logiki dopasowania ani schematu DB.

### Zmiany

1. **Search: `limit: 5` → `limit: 3`**
   - W wywołaniu `firecrawl.search(query, { limit: 5, sources: ["web"] })` zmieniam `limit` na `3`.
   - Filtr marketplace (`isMarketplaceUrl`) i tak ograniczał wyniki do top 3 — teraz Firecrawl od razu zwraca 3 zamiast 5, czyli mniej kredytów na samym searchu.
   - Konsekwencja: jeśli z 3 wyników 2–3 to marketplace, zostanie 0–1 źródeł zamiast 1–3. Akceptowalny kompromis dla oszczędności.

2. **Scrape: tylko `markdown` (bez `html`)**
   - W `firecrawl.scrape(url, { formats: ["markdown", "html"], onlyMainContent: true })` usuwam `"html"`.
   - HTML był używany tylko do regexu `<img src=...>` jako fallback dla obrazków — markdown i tak zawiera `![](url)` + `metadata.ogImage`, więc kandydaci na zdjęcia nie znikają.
   - Usuwam też kod, który czyta `result.html` i parsuje go regexem (jeśli istnieje), zostawiając ścieżkę markdown + ogImage.
   - Efekt: ~50% mniejszy payload scrape’u → mniej kredytów i mniej tokenów wejściowych dla Gemini.

### Zakres plików

- `src/lib/pim/_workers.server.ts` — wyłącznie blok `runFirecrawlDiscovery` (search + scrape).

### Poza zakresem (świadomie pomijam)

- Skracanie `slice(0, 6000)`, kompresja system promptu Gemini, cache URL — nie ruszam, zgodnie z decyzją użytkownika.
- Nie zmieniam schematu DB, RLS, ani innych workerów.

### Weryfikacja

- Po zmianie szybki przegląd, czy nie został martwy import / nieużywana zmienna `html`.
- Bez migracji.