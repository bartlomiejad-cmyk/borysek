## Cel

Uzgodnić kryterium „bez źródeł" między paskiem pipeline a `startFirecrawlDiscovery`, żeby klik „Wyszukaj źródła (N)" faktycznie uruchamiał discovery, a resetowanie źródeł pozostawiało spójny stan.

## Zmiany

### 1. `src/lib/pim/firecrawl.functions.ts` — `startFirecrawlDiscovery`

- Wybór produktów opiera się wyłącznie na:
  - jawnej selekcji przez `productIds` (użytkownik zaznaczył/otworzył produkt), **lub**
  - `pipeline_status IS NULL` / `= 'IMPORTED'`, gdy `productIds` nie podano.
- Usuwam obecny filtr sprawdzający obecność `search_results.term` (to on powoduje „Brak produktów do przetworzenia").
- `onlyMissing` staje się no-opem/deprecated: gdy przekazano jawne `productIds`, produkt jest zawsze kwalifikowalny (regresja: „Szukaj ponownie" z edytora działa dla dowolnego statusu). Gdy `productIds` brak, filtruję po `pipeline_status = IMPORTED`.
- Guard „brak nazwy" pozostaje — produkty z pustą `nazwa` są pomijane i liczone osobno; nie przerywają całego zadania.
- Rzut wyjątku tylko gdy `targetIds.length === 0` — z rozdzielonymi licznikami: `skippedAdvanced` (status dalej niż Import) i `skippedNoName`.
- Ładunek wyjątku zawiera oba liczniki: front pokazuje precyzyjny toast.

### 2. Toast błędu (klient) — `projects.$id.index.tsx` (CTA banner + Narzędzia)

- Po nieudanym starcie parsuję nowe liczniki i wyświetlam: `0 produktów: X pominięto (status dalej niż Import), Y pominięto (brak nazwy).`
- Fallback zostawiam dla nieoczekiwanych błędów sieciowych.

### 3. „Wyczyść źródła" — pełny reset (project-level i product-level)

Obecny `recleanProductSources` sanityzuje tylko zapisane treści. Rozdzielam intencję na dwie akcje:

- **Sanitize** (dotychczasowe) — pozostaje pod obecnym tooltipem „Usuwa logo metod płatności…" w narzędziach projektu i w edytorze produktu; label zmieniam na „Wyczyść śmieci ze źródeł" (bez zmiany działania).
- **Reset źródeł** — nowy `resetProductSources` w `firecrawl.functions.ts`, wywoływany z:
  - narzędzi projektu (whole project),
  - edytora produktu (single product, scope po `productIds`).
  Wywołanie deterministycznie:
  - kasuje `search_results` dla objętych produktów (po `term`, w ramach `project_id`, tylko jeśli term nie jest używany przez inny produkt w projekcie),
  - kasuje `product_sources` powiązane z tymi produktami (przez `matching_products` / bezpośrednie linki, spójne z modelem obecnym w kodzie),
  - resetuje discovery-related pola w `enrichments` (te, które worker ustawia przy discovery/matching: `image_scores`, `image_meta.discovery`, `viz_analysis` jeśli oznaczone jako auto — analog do obecnych resetów w matching),
  - ustawia `pipeline_status = 'IMPORTED'` (nigdy nie modyfikuje `manual_lock`, `review_status`, `client_guidelines`, oceny audytu, ani ręcznych override'ów sceny wizualizacji: `viz_analysis.manual = true`).

### 4. Regresja: per-product „Szukaj ponownie" (edytor)

- Pozostaje bez zmian: przekazuje `productIds: [id]`, więc trafia w gałąź jawnej selekcji i działa dla dowolnego statusu.

## Poza zakresem

- Silnik wyszukiwania (Firecrawl + Apify combined, warianty, preselekcja AI) — bez zmian.
- Backfill — niepotrzebny; jeden dotknięty produkt zacznie działać po pierwszym kliknięciu CTA.

## Weryfikacja

1. Na projekcie `ps2` (product „Filtry Do Rekuperatora…", `pipeline_status = IMPORTED`, stare `search_results` istnieje) klik „Wyszukaj źródła (1)" tworzy `bulk_jobs` (`FIRECRAWL_DISCOVERY`, total 1). Sprawdzę w `bulk_jobs` po uruchomieniu.
2. Import produktu bez `nazwa` i klik CTA → toast: „0 produktów: 0 pominięto (status dalej niż Import), 1 pominięto (brak nazwy)."
3. „Reset źródeł" na produkcie ze statusem `GOLDEN_READY` → status wraca do `IMPORTED`, `manual_lock` i `review_status` niezmienione, `search_results` dla jego termu skasowane (o ile nie współdzielone).
4. „Szukaj ponownie" z edytora dla produktu w `GOLDEN_READY` → discovery startuje mimo statusu.
