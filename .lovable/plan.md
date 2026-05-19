# Naprawa: zdjęcia ze wszystkich źródeł produktu

## Problem
Lista produktów i widok szczegółów pokazują zdjęcia tylko z `picked_urls`, a te są obecnie ograniczane do pierwszych 3 źródeł dopasowanych podczas matchingu. Jeśli produkt ma więcej źródeł w wynikach wyszukiwania, zdjęcia z dalszych źródeł nie trafiają do głównego widoku.

## Plan zmian

1. **`src/lib/pim/matching.functions.ts`**
   - Przestać ucinać dopasowane URL-e do 3.
   - Zapisywać w `picked_urls` wszystkie URL-e z dopasowanego wyniku wyszukiwania, po odfiltrowaniu pustych wartości i duplikatów.
   - Dzięki temu nowe uruchomienie „Dopasuj” zapisze komplet źródeł dla każdego produktu.

2. **`src/lib/pim/queries.functions.ts`**
   - W `listProductsWithEnrichment` zbierać zdjęcia z pełnej listy `picked_urls`, bez limitu 12 zdjęć po stronie danych.
   - W `getProductDetail` również nie ucinać `picked_urls` do 3, żeby szczegóły produktu pokazywały wszystkie źródła.
   - Zachować filtrowanie ukrytych zdjęć (`hidden_images`) oraz dołączanie `extra_images`.

3. **`src/routes/_auth/projects.$id.index.tsx`**
   - W głównym widoku pokazywać więcej miniatur albo wszystkie zebrane zdjęcia w elastycznym zawijanym układzie.
   - Zostawić powiększenie po najechaniu i wyświetlanie wymiarów obrazu.
   - Jeśli zdjęć jest dużo, dodać kompaktowy licznik typu `+8`, żeby wiersz tabeli nie rozjeżdżał układu.

4. **Spójność istniejących danych**
   - Po zmianie trzeba ponownie kliknąć „Dopasuj” dla projektu, bo aktualne rekordy mają już zapisane tylko 3 URL-e w `picked_urls`.
   - Alternatywnie mogę dodać jednorazową logikę, która przy następnym dopasowaniu automatycznie nadpisze stare, ucięte listy.

## Co zostaje bez zmian
- Import JSON/CSV.
- Struktura bazy danych.
- Ukrywanie zdjęć i eksport.
