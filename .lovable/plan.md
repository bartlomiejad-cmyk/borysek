## Cel

Przyspieszyć wyszukiwanie źródeł i zmniejszyć hałas, bez naruszania: quota fallback, PIM_RESCRAPE, trybu `compatible`, oraz trybu `firecrawl`-only.

## Zmiany w `src/lib/pim/_workers.server.ts` (`runFirecrawlDiscovery`)

### 1. Równoległy Apify per wariant
- Zamiast sekwencyjnej pętli wariantów: `Promise.allSettled` dla wszystkich wariantów jednego produktu.
- Każde uruchomienie przed startem sprawdza circuit breaker quota; jeśli którykolwiek `resolve` → `quota_exhausted`, ustawiamy job-flag jak dziś.
- Awaria pojedynczego wariantu nie przerywa rodzeństwa ani produktu. Produkty nadal przetwarzane sekwencyjnie (≤4 wariantów × 1 produkt ≤ 5 równoległych runów Apify — bezpieczne wobec konta).

### 2. Warunkowy Firecrawl search (status-aware, tylko `combined`)
- Dla wariantu EAN (A): **nigdy** nie odpalamy FC search w `combined` (Apify obsługuje; FC index niewiarygodny dla bare-numeric).
- Dla wariantów nazwowych (B/C/D): FC search **tylko** gdy status Apify tego wariantu = `error` lub `quota_exhausted`.
- `empty` (Apify OK, 0 organic) → **bez** fallbacku; log `"⏭ FC pominięty (Google: 0 wyników)"`.
- Tryb `firecrawl`-only: bez zmian.
- FC EAN-in-snippet hard post-filter: zostawiamy tylko w gałęzi `firecrawl`-only (w `combined` staje się dead code).

### 3. Dedup, blacklista, pool preselekcji
- Host dedup **1/host** (dziś 2) — zarówno w merged pool jak i przed AI preselekcją.
- Wybór URL wewnątrz hosta: (1) dokładny EAN w title/snippet, (2) najlepsza pozycja SERP.
- Kolejność pozostaje: blacklist/marketplace → dedup → AI preselekcja. Picki AI są **finalne** — nic ich po preselekcji nie odrzuca.
- Rozszerzyć istniejącą stałą `MARKETPLACE_DOMAINS` (jedna lista, nie duplikować): dodać `skapiec.pl`, `nokaut.pl`, `opineo.pl`; zgeneralizować dopasowanie Allegro do `allegro.*` (dowolny TLD). Zweryfikować że ceneo/allegro.pl/amazon są już obecne.
- Limit AI preselekcji: **12 → 8** (rezerwa 4 dla PIM_RESCRAPE przy `scrape_cap`=4).

### 4. Prompt preselekcji (`src/lib/pim/serp-preselect.server.ts`)
Zaktualizować `SYSTEM_PROMPT` (ścieżka Apify, gemini-2.5-flash-lite):

> "Wybierz maksymalnie 8 adresów. Najwyższy priorytet: strony z dokładnym EAN produktu w tytule lub snippecie. Następnie: wysoko rankowane wyniki, których tytuł/snippet wskazuje na konkretną kartę produktu z parametrami (nie stronę kategorii, nie blog, nie agregator) — przepuszczaj je także bez widocznego EAN, sklepy często trzymają EAN tylko w danych strukturalnych. Odrzucaj: kategorie, poradniki, agregatory, inne warianty produktu."

Cap `picks` w kodzie parsera: 12 → 8.

### 5. Funnel scrape
- Default `projects.settings.scrape_cap`: **6 → 4**. Istniejące projekty z zapisaną wartością zachowują ją — zmieniamy tylko default przy odczycie/tworzeniu.
- Early-exit bez zmian: 3 contributing (≥1 accepted image OR ≥2 features OR cleaned description ≥200 znaków z `page_matches_product !== false`).
- LLM cleaner — STRICT mode tylko (compatible bez zmian). W prompcie `page_matches_product` dodać:

> "Potwierdź, że strona fizycznie dotyczy szukanego produktu: zgodny EAN lub MPN w treści/danych strukturalnych, a w ich braku ścisła zgodność marki+modelu+wariantu w nazwie. W razie niezgodności zwróć page_matches_product=false."

Ścieżka `matching_mode='compatible'` w `llm-cleaner.server.ts` — bez zmian.

### 6. Telemetria
Rozszerzyć zapisy per produkt (`product_events` discovery_search) i job `usage` jsonb:
- `fc_search_skipped` (count + powód: `apify_ok_empty` | `ean_variant_combined`)
- `dedup_dropped` (count + powody: `host_dup`, `marketplace`, `blacklist`)
- `preselect_kept` (liczba picków AI, cap 8)
- `variant_error` (count z Promise.allSettled rejections)

## Bezpieczeństwo zmian
- `firecrawl`-only mode: bez zmian (widoczne w kodzie: gałąź `provider === 'firecrawl'`).
- PIM_RESCRAPE: nadal czerpie z niescrapowanych URL-i wskazanych przez AI (8 picków − ~4 scrape = zapas 4).
- Circuit breaker/quota: bez zmian, tylko sprawdzany przed każdym równoległym runem.
- `compatible` matching mode: gałąź LLM cleaner nietknięta.

## Files touched
- `src/lib/pim/_workers.server.ts` — główna refaktoryzacja `runFirecrawlDiscovery`, `MARKETPLACE_DOMAINS`, default `scrape_cap`.
- `src/lib/pim/serp-preselect.server.ts` — prompt + cap.
- `src/lib/pim/llm-cleaner.server.ts` — wzmocnienie `page_matches_product` w gałęzi STRICT.

Brak migracji DB, brak zmian UI, brak zmian w ingest/media/matching.