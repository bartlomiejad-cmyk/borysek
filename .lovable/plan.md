Plan naprawy:

1. Wzmocnię `sanitizeProductDescription`, żeby usuwał całe bloki markdown zawierające:
   - galerie obrazków produktu powielone na początku opisu,
   - linkowane logo producenta/brandu,
   - cenę, „Write a review”, Follow/Compare,
   - adresy sklepów, godziny otwarcia i pozostałości po mapach,
   - osierocone linki/urwane fragmenty po czyszczeniu.

2. Podepnę to czyszczenie bezpośrednio w `runMatching` przed walidacją AI źródeł:
   - po pobraniu `product_sources` opisy będą sanitizowane,
   - jeśli sanitizacja coś zmieni, zapiszę czysty opis z powrotem do `product_sources`,
   - walidator AI dostanie już czysty opis, a nie surowy scrape sklepu.

3. Wzmocnię etap generowania złotego opisu:
   - `sourceBlocks` użyje zawsze sanitizowanego opisu,
   - wynik `golden_description` przejdzie przez `sanitizeProductDescription`, żeby nie przepuścić śmieci nawet jeśli AI je skopiuje.

4. Rozszerzę prompt filtra scrape’u o dokładnie ten przypadek: miniatury galerii, logo brandu, ceny, recenzje, adresy sklepu i godziny otwarcia mają być bezwzględnie pomijane.

5. Po wdrożeniu zweryfikuję składnię i miejsca wywołań, bez zmiany schematu bazy danych.