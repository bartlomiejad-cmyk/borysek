# Fix: sekcja "Zdjęcie główne (FAL.ai)" — brak podglądu i nieaktywny przycisk

## Co się dzieje

Dla tego produktu w bazie są oceny AI zdjęć (`image_scores`), ale `image_meta` (wymiary w/h) jest puste. Aktualny ranking mnoży ocenę razy powierzchnię obrazka — bez wymiarów wynik to zawsze 0, więc aplikacja "nie widzi" żadnego głównego zdjęcia. Efekt:

- przycisk **Regeneruj** jest wyszarzony,
- w ramce FAL.ai nie ma żadnego podglądu (pokazujemy tylko wynik regeneracji, którego jeszcze nie ma).

Przypomnienie kontekstu: zdjęcia źródłowe pochodzą ze stron konkurencji (scrapowane do `product_sources.images` / `extra_images`), a FAL.ai robi z nich nasze czyste miniaturki na białym tle.

## Zmiany (1 plik: `src/routes/_auth/projects.$id.products.$pid.tsx`)

1. **Ranking odporny na brak wymiarów** — gdy `image_meta` jest puste, oceniamy tylko po `is_central + is_clean`. Banery/śmieci dalej dostają 0. Dzięki temu zawsze wyłoni się "główne" zdjęcie konkurencji.
2. **Fallback `mainUrl`** — jeśli mimo wszystko ranking nic nie zwróci (np. brak ocen AI), bierzemy pierwsze niezukrytych zdjęcie ze źródeł, żeby przycisk Regeneruj nie był nigdy zablokowany bez powodu.
3. **Podgląd oryginału w sekcji FAL.ai** — dopóki nie ma jeszcze regenerowanej wersji, pokazujemy miniaturkę oryginalnego zdjęcia konkurencji z podpisem "Oryginał (źródło)". Po regeneracji nadal widać wynik FAL.ai (jak dziś).

## Bez zmian

- Logika serwerowa regeneracji (model `bytedance/seedream/v4/edit`, bucket `regenerated-images`, kolumny w `enrichments`).
- Eksport CSV i pozostała część strony produktu.
