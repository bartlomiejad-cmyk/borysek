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

## Co znalazłem w bazie
Drugi użytkownik (login przez Google) ma jeden projekt „Bron":
- 226 rekordów `product_sources`, z czego **0 ma cokolwiek w `extra_images`**.
- Wszystkie 523 rekordy `enrichments` mają **dokładnie 3 `picked_urls`** (stary, obcięty zapis).

Czyli to nie jest bug w kodzie — kod listy działa, ale po prostu **nie ma czego pokazać**:
- `extra_images` w `product_sources` są puste, bo dane zostały wgrane plikiem, w którym tej kolumny nie było (albo była pusta).
- `picked_urls` zostały zapisane jeszcze przed naprawą obcięcia do 3 — dlatego nawet po dorzuceniu `extra_images` widać tylko 3 źródła zamiast wszystkich.

Twoje konto ma świeższe projekty wykonane po poprawkach, dlatego u Ciebie zdjęcia „extra" są.

## Co musi zrobić drugi użytkownik (bez zmian w kodzie)
1. Ponownie wgrać `product_sources` z pliku, który ma wypełnioną kolumnę `extra_images` (to po stronie ich pipeline'u scrapera — aplikacja sama nie scrapuje stron).
2. Wcisnąć **„Dopasuj"** w projekcie — to przepisze `picked_urls` w `enrichments` pełną listą URL-i (bez obcinania do 3), zgodnie z aktualnym kodem `runMatching`.

Po tych dwóch krokach miniatury „extra" pojawią się na liście tak samo jak u Ciebie.

## Opcjonalna zmiana w aplikacji (do decyzji)
Jeżeli chcesz, mogę dodać na stronie projektu mały komunikat / przycisk „Odśwież dopasowanie i obrazy" pokazujący się, gdy w projekcie są enrichments z `array_length(picked_urls) <= 3` albo `product_sources` bez `extra_images` — żeby drugi użytkownik dostał wyraźną podpowiedź zamiast zgadywać. To czysto UI, bez ruszania logiki backendu.

## Co zostaje bez zmian
Schemat bazy, matching, scraping, eksport, widok szczegółów, układ miniatur na liście — wszystko jest sprawne, problem dotyczy wyłącznie starych danych w jednym projekcie.
