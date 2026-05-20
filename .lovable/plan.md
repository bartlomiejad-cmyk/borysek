# Flow: Dopasuj → Generuj złote rekordy (weryfikacja zdjęć + generacja z cechami)

## Cel

Po dopasowaniu (`Dopasuj`) klik w `Generuj złote rekordy` ma dla każdego produktu z dopasowaniem wykonać:
1. Weryfikację zdjęć ze źródeł — wykryć watermarki i niezgodności z produktem, oznaczyć złe zdjęcia jako ukryte (`hidden_images`), żeby nie trafiły do generacji ani eksportu.
2. Następnie generację złotego rekordu (nazwa + opis + cechy) — ze zdjęć już przefiltrowanych, z pozostałych źródeł.

Jeśli weryfikacja odrzuci wszystkie zdjęcia / źródła — i tak generujemy z oryginalnych `picked_urls` (tryb best-effort, bez blokowania).

## Zmiany

### 1. `src/lib/pim/ai.functions.ts` — nowy `verifySources`

Nowa funkcja `verifySources({ productId })` analogiczna do obecnego `verifyProduct`, ale wywoływana PRZED generacją:
- pobiera `picked_urls` + zdjęcia (`images` + opcjonalnie `extra_images`) z `product_sources`,
- **filtr rozmiaru (pre-AI)**: dla każdego URL-a pobiera realny rozmiar pikseli (HEAD/range + dekoder, albo `probe-image-size`-style). Zdjęcia mniejsze niż 600×600 px trafiają na listę do odrzucenia. Wyjątek: jeśli po odrzuceniu wszystkich małych zostałoby 0 zdjęć w danym produkcie, zachowujemy największe dostępne (fallback: „jedyne zdjęcie") — żeby produkt nie został bez miniatury.
- pyta model wizyjny (Gemini 2.5 Flash) — już na przefiltrowanym zestawie — o:
  - URL-e zdjęć z watermarkiem / logo sklepu,
  - URL-e zdjęć niepasujących do produktu (na podstawie nazwy/EAN/kodu z `source_products`),
- dopisuje wszystkie wskazane URL-e (małe + watermark + niezgodne) do `enrichments.hidden_images` (deduplikacja), z zachowaniem wyjątku „jedyne zdjęcie",
- zapisuje raport do `enrichments.quality` (do podglądu w widoku weryfikacyjnym) — z osobną sekcją `small_images: string[]`.

#### Detale filtra rozmiaru
- Próg: min(width, height) ≥ 600 px (kwadrat 600×600, ale akceptujemy też większe prostokąty).
- Pomiar: `fetch` z `Range: bytes=0-65535` + parser nagłówków JPEG/PNG/WebP (lekka funkcja, bez `sharp`/`canvas` — niedostępne w Workerze). Cache wymiarów w pamięci procesu na czas trwania bulku.
- Jeśli pomiar się nie powiedzie (timeout/404/nieznany format) — traktujemy jak „nieznany rozmiar" i NIE odrzucamy z tego powodu.
- Wyjątek „jedyne zdjęcie": jeśli po odjęciu małych z danego produktu zostałoby 0, zostawiamy największe (po `width*height`); jeśli żaden nie ma znanego rozmiaru — zostawiamy pierwsze.

Obecny `verifyProduct` (post-generacji, sprawdza też nazwę i cechy) zostaje — używany w widoku produktu.

### 2. `generateGoldenRecord` bez zmian merytorycznych

Już generuje nazwę + opis + cechy w jednym callu (po poprzednim wdrożeniu). Korzysta z opisów tekstowych źródeł, więc filtr zdjęć go nie blokuje. Bez zmian.

### 3. `src/routes/_auth/projects.$id.index.tsx` — sekwencja w `generateAll`

W handlerze przycisku „Generuj złote rekordy" dla każdego produktu (CONCURRENCY=5):
1. `verifySourcesFn({ productId })` — try/catch, błąd weryfikacji NIE blokuje generacji (logowany, idziemy dalej).
2. `genFn({ productId, mode: "all" })`.

Progress pokazuje 2 fazy łącznie (np. `Generowanie 12/40 (weryfikacja + złoty rekord)`), albo dwa paski — wystarczy zaktualizować label paska na „Weryfikacja i generacja {done}/{total}".

### Co zostaje bez zmian

- Schemat bazy (`hidden_images`, `quality`, `golden_features` już istnieją).
- RLS.
- Widok produktu (`projects.$id.products.$pid`) — dalej ręczne `Wygeneruj cechy` i `Weryfikuj`.
- Eksport, scraping, matching.

## Detale techniczne

- `verifySources` przyjmuje opcjonalnie `mode: "all" | "missing"` — domyślnie „all" w bulku.
- Limit zdjęć przekazanych do modelu wizyjnego: do 8 (oszczędność tokenów).
- Sanityzacja blacklistą nie dotyczy weryfikacji (operuje tylko na URL-ach).
- Brak nowych sekretów; korzystamy z `LOVABLE_API_KEY`.

---

# (Historyczne) Naprawa: lista produktów pokazuje tylko 1 zdjęcie

## Problem

Na liście produktów dla produktu „S&B 9 LUGER FMJ 8 g" widać tylko 1 miniaturę, mimo że w bazie są 3 źródła z łącznie 5 zdjęciami (luska 1, militariatylice 1, twojabron 1+2 extra).

## Przyczyna

Server function `listProductsWithEnrichment` (`src/lib/pim/queries.functions.ts`) pobiera `product_sources` jednym zapytaniem z `.limit(5000)`. PostgREST w Supabase ma jednak twardy limit 1000 wierszy na pojedynczą odpowiedź — `.limit(5000)` jest po cichu obcinane do 1000.

Projekt ma 1610 wierszy w `product_sources`. Posortowane po `created_at`:
- luska — pozycja 319 (mieści się)
- militariatylice — pozycja 1375 (poza limitem)
- twojabron — pozycja 1465 (poza limitem)

Stąd `imgMap` nie zna URL-i militariatylice i twojabron, więc na liście zostaje tylko 1 zdjęcie z luska. Widok szczegółów działa, bo używa `.in("url", picked_urls)` z krótką listą URL-i (zwraca komplet bez obcinania).

## Naprawa

W `listProductsWithEnrichment` zamienić pojedyncze zapytanie na paginację po 1000 wierszy używając `.range(from, from + 999)` w pętli, aż strona zwróci mniej niż 1000 rekordów. Dodać `.order("created_at", { ascending: true })` dla stabilnej paginacji.

## Pliki

- `src/lib/pim/queries.functions.ts` — funkcja `listProductsWithEnrichment`, blok pobierający `product_sources`.

## Brak innych zmian

- Schemat bazy bez zmian.
- RLS bez zmian.
- UI bez zmian (renderowanie miniatur jest poprawne, MAX=8).
- Inne server functions bez zmian — `getProductDetail` używa `.in("url", picked)` z małą listą i nie jest dotknięte limitem.
# Auto-generowanie cech razem ze złotym rekordem

## Problem
Cechy (`golden_features`) są generowane wyłącznie ręcznie — trzeba wejść w każdy produkt i kliknąć w panelu szczegółów. Przycisk „Generuj złote rekordy" na liście projektu wywołuje tylko `generateGoldenRecord`, który tworzy `golden_name` + `golden_description`, ale nie cechy.

## Plan

### 1. `src/lib/pim/ai.functions.ts` — jeden wspólny call do modelu
- Rozszerzyć schemat odpowiedzi `generateGoldenRecord` z `{name, description}` na `{name, description, features: [{key, value}]}` (features opcjonalne, max 60, sanityzacja z blacklistą tak samo jak teraz).
- Zaktualizować system/user prompt: poprosić model, żeby przy okazji złotego rekordu wyciągnął cechy techniczne z tych samych źródeł (te same reguły co w `generateFeatures` — bez wymyślania, bez marketingu, klucze po polsku).
- Zapisywać `golden_features` w tym samym `update` co `name`/`description`, ale **tylko jeśli** model coś zwrócił i pole jest puste lub `mode === "all"` (żeby ręczne edycje nie były nadpisywane przy częściowej regeneracji).
- `generateFeatures` jako osobny endpoint zostaje (dla ręcznego „Wygeneruj cechy" w widoku produktu) bez zmian.

### 2. `src/routes/_auth/projects.$id.index.tsx`
- Bez zmian w UI — bulk przycisk „Generuj złote rekordy" automatycznie skorzysta z rozszerzonego handlera i wypełni cechy dla wszystkich produktów, które mają dopasowane źródła.
- Ewentualnie krótka aktualizacja podpowiedzi przy pasku postępu („generowanie nazwy, opisu i cech…").

### Co zostaje bez zmian
Schemat bazy (pole `golden_features` już istnieje), matching, eksport, widok weryfikacyjny, scraping, RLS.

## Detale techniczne
- Jedno wywołanie modelu zamiast dwóch — szybciej i taniej niż łańcuch `generateGoldenRecord` → `generateFeatures`.
- W razie, gdy model nie zwróci `features` albo zwróci pustą tablicę, zostawiamy istniejące `golden_features` nietknięte (brak regresji dla produktów, którym ktoś już ręcznie ustawił cechy).
- Limit długości opisu i sanityzacja bez zmian.
