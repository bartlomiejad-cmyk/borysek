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
