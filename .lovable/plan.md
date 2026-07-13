## Problem

W tej chwili `runMatching` (src/lib/pim/matching.functions.ts) zapisuje do `enrichments.picked_urls` **wszystkie** URL-e z `search_results.organic_urls` (10 z SERP-a), a walidacja AI odrzuca tylko te, które ewidentnie nie pasują nazwą/marką. Nie ma żadnego rankingu jakości danych — źródła bez tytułu, bez opisu i bez zdjęć zostają w produkcie na równi z pełnymi kartami produktowymi.

Dlatego w projekcie `hurtownia-format` widzisz po 10 pustych/prawie-pustych źródeł na każdym produkcie.

## Rozwiązanie: scoring + cap 5

Zmiana wyłącznie w `src/lib/pim/matching.functions.ts` (bez migracji, bez UI):

1. Po pobraniu `product_sources` do `srcMap` rozszerzyć zapis o sygnały jakości: długość `description` po sanitizacji, obecność `title`, liczba `images` + `extra_images` po filtrze, oraz „ma-JSON-LD/EAN" (heurystycznie: EAN produktu występuje w tytule lub opisie).
2. Zdefiniować `scoreSource(src, product)`:
   - +3 gdy `description` po sanitize ≥ 200 znaków, +1 gdy 40–199, 0 gdy krócej
   - +2 gdy `title` niepuste i zawiera min. jeden kluczowy token nazwy produktu (marka/model)
   - +1 za każde zdjęcie do maks. +3 (`images.length + extra_images.length`)
   - +2 gdy EAN produktu pojawia się w tytule lub opisie
   - −5 gdy źródło jest w wewnętrznej liście „śmieciowych" (allegro-listing bez opisu, pusty rekord itd.) — praktycznie: `!title && description length < 40 && images.length === 0`
3. Po walidacji AI (`kept`) posortować `u.picked_urls` malejąco wg score i przyciąć do **TOP 5**. Jeśli score TOP-a jest 0 lub ujemny → `status = "PENDING"`.
4. `matched` liczyć dopiero po przycięciu (produkt bez 1+ jakościowego źródła nie jest „matched").
5. Zachować obecne czyszczenie opisów/obrazków w `product_sources` — nie usuwamy rekordów z bazy (mogą wracać po ponownym scrape), tylko nie linkujemy ich w `picked_urls`.

Limit 5 zaszyty jako `const TOP_SOURCES_PER_PRODUCT = 5` na górze pliku — łatwo podnieść w przyszłości.

## Uruchomienie po wdrożeniu

Klient klika **Dopasuj** ponownie w projekcie `hurtownia-format` — `runMatching` przelicza `picked_urls` na podstawie już zescrapowanych `product_sources`, bez ponownego Firecrawla. Efekt: max 5 najlepszych źródeł na produkt, śmieciowe znikają.

## Pytania kontrolne przed budową

- Waga „ma zdjęcia" ma być mocniejsza (np. +5 zamiast +3)? Domyślnie waży tak samo jak długi opis.
- Czy zamiast twardego cap-a 5 wolisz cap 5 **tylko** jeśli jest przynajmniej 5 „dobrych" (score ≥ 3), inaczej wszystkie z score > 0?