# Zwiększenie limitu wyników wyszukiwania Firecrawl z 3 do 10

## Cel
Więcej źródeł produktów trafia do pipeline'u discovery, zanim marketplace filter i AI je przefiltrują.

## Zmiany w kodzie
W pliku `src/lib/pim/_workers.server.ts`:

1. **Linia ~922** — `firecrawl.search(query, { limit: 3, ... })` → `limit: 10`
2. **Linia ~945** — `.slice(0, 3)` po filtrze marketplace → `.slice(0, 10)`

## Koszt
- Firecrawl Search: z 3 do 10 kredytów na produkt (jeśli Google zwraca tyle wyników).
- Scrape pozostaje bez zmian — dalej max 3 źródła są scrapowane (logika dalej w funkcji ogranicza do top 3 po AI validacji).

## Weryfikacja
Po wdrożeniu: uruchomić "Wyszukaj źródła" dla produktu i sprawdzić logi — powinno być `10 wyników` zamiast `3 wyników` przed filtrem marketplace.