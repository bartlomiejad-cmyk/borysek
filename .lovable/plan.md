# Fix: sekcja "Zdjęcie główne (FAL.ai)" — brak podglądu i nieaktywny przycisk

## Diagnoza

W bazie produkt ma `image_scores` (oceny AI), ale `image_meta` jest puste `{}` (brak zapisanych wymiarów w/h). Funkcja `scoreFor(url)` w `projects.$id.products.$pid.tsx` liczy:

```
area  = (w ?? 0) * (h ?? 0)     // = 0 gdy brak meta
score = (is_central + is_clean) * area  // = 0
```

Skutek: `mainUrl = null`, więc:
- przycisk **Regeneruj** jest `disabled` (warunek `!mainUrl`),
- w sekcji nie ma żadnego podglądu (renderujemy tylko `regeneratedUrl` lub fallback "Brak zdjęcia głównego").

Dodatkowo sekcja nigdy nie pokazuje **oryginalnego** zdjęcia źródłowego przed regeneracją — tylko wynik FAL.ai. To myli użytkownika.

## Zmiany (1 plik: `src/routes/_auth/projects.$id.products.$pid.tsx`)

1. **Naprawić `scoreFor`** — gdy brak `image_meta`, użyć `area = 1` jako fallback, żeby ranking opierał się wyłącznie na ocenach AI (`is_central + is_clean`). Banery/śmieci nadal dają 0.
2. **Fallback `mainUrl`** — jeśli mimo wszystko `mainUrl` jest null, użyć pierwszego niezukrytego URL z `allVisible`, żeby zawsze było co regenerować, gdy są jakiekolwiek zdjęcia.
3. **Podgląd oryginału** — gdy nie ma jeszcze `regeneratedUrl`, ale `mainUrl` istnieje, pokazać miniaturę oryginalnego zdjęcia z podpisem "Oryginał" w ramce sekcji FAL.ai. Po regeneracji nadal pokazujemy wynik (jak dziś).

## Bez zmian

- Logika serwerowa (`regen.functions.ts`, model seedream v4) — bez zmian.
- Bucket `regenerated-images`, kolumny w `enrichments` — bez zmian.
- Reszta UI strony produktu — bez zmian.
