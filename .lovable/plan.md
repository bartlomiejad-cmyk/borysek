## Problem

Po wejściu do produktu (np. „Taśma do metkownicy…") główne zdjęcie (FAL.ai) i pierwsza miniatura w „Wybrane zdjęcia" są uszkodzone (broken image icon). Pozostałe źródłowe miniatury renderują się poprawnie.

## Diagnoza

W bazie dla tego produktu:
- `pinned_main_url = https://imge.pl/…` (prawidłowy URL)
- `regenerated_main_image = "__imported__"` ← sentinel z importu CSV, nie URL

Widok `src/routes/_auth/projects.$id.products.$pid.tsx` używa `enrichment.regenerated_main_image` bezpośrednio w dwóch miejscach:
1. Linia 193–194 — pchane jako pierwszy element `allVisible` (stąd broken „Główne" w galerii).
2. Linia 380 (`regeneratedUrl`) — używane w `<img src={regeneratedUrl}>` (linia 645) w sekcji „Zdjęcie główne (FAL.ai)".

Sentinel `"__imported__"` jest już filtrowany w innych miejscach (`GenerateVisualizationsDialog`, `ai.functions.ts`, `_workers.server.ts`), ale nie w tym widoku ani w trasach `share.$token.tsx`, `share.$token.p.$pid.tsx`, `_auth/…/preview.tsx`.

## Zmiana

Wprowadzić jednolity helper (np. `resolveRegenUrl(v): string | null` — zwraca `null` gdy pusty lub `"__imported__"`) i podmienić bezpośrednie użycia `regenerated_main_image` w warstwie widoku:

- `src/routes/_auth/projects.$id.products.$pid.tsx`
  - linia 193: `regenUrlEarly = resolveRegenUrl(enrichment?.regenerated_main_image)`
  - linia 380: `regeneratedUrl = resolveRegenUrl(...)`
  - Efekt: gdy sentinel — pokazujemy fallback z `pinned_main_url` / `mainUrl` (blok `!regeneratedUrl && mainUrl` już istnieje w liniach 651–662) i nie dodajemy uszkodzonej pozycji do galerii.

- `src/routes/share.$token.tsx` (linia 245, 271–272)
- `src/routes/share.$token.p.$pid.tsx` (linia 78)
- `src/routes/_auth/projects.$id.products.$pid_.preview.tsx` (linia 58)
  - Analogicznie przepuścić przez helper — na publicznym share sentinel obecnie też może wygenerować broken img w pierwszym slocie.

Helper wyląduje w `src/lib/pim/media.ts` (nowy mały plik) lub obok istniejącego kodu w `queries.functions.ts` (utility eksportowany).

## Zakres poza tą zmianą (bez ruszania teraz)

Zapis `regenerated_main_image: "__imported__"` w `ingest.functions.ts:108` zostaje — inne części (dialogi, workery) na nim polegają jako fladze „miniatura pochodzi z importu, nie regeneruj". Rozważymy oddzielne pole `regen_source: 'imported' | 'fal' | null` w osobnym zadaniu, jeśli będziesz chciał posprzątać schemat.

## Weryfikacja

- Po zmianie w widoku produktu: pierwsza kafelka „Główne" w „Wybrane zdjęcia" pokazuje `pinned_main_url` (imge.pl), sekcja „Zdjęcie główne (FAL.ai)" pokazuje oryginał ze źródła z podpisem „Oryginał (źródło) — kliknij Regeneruj…" (bo `regeneratedUrl` = null).
- Regeneracja przez FAL.ai zapisuje realny URL do `regenerated_main_image` (helper go przepuszcza) i UI natychmiast pokazuje wygenerowaną miniaturę.
- Publiczny `/share/$token` i `/preview` nie wstawiają już sentinela do galerii.