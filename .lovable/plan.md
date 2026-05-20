# Naprawa: lista produktów pokazuje tylko 1 zdjęcie

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
