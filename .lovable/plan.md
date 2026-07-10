## Problem

Na screenie miniaturka tonera HP 207X ma wyraźnie **szare/przydymione tło**, mimo że prompt Seedream v4 edit w `src/lib/pim/_workers.server.ts` (funkcja `buildSeedreamPrompt` + inline prompt w `src/lib/pim/regen.functions.ts`) już zawiera „PURE WHITE #FFFFFF". Model najwyraźniej interpretuje to jako „jasne studio" i zostawia lekki gradient/vignette.

## Zmiany (tylko backend, prompty + lekki post-processing tła)

### 1. `src/lib/pim/regen.functions.ts` — prompt Seedream (miniaturka „Regeneruj ponownie")
- Przeformułować pierwsze zdanie: zamiast „CRITICAL BACKGROUND" dać twarde „BACKGROUND = flat solid #FFFFFF fill, RGB(255,255,255), luminance L=100, no lighting variation, no falloff, no vignette, no gradient, no shadow on background, no soft box reflection, no seamless paper curve — the background is a mathematically flat white plane, identical pixel value in all four corners and along all edges."
- Dodać: „If the model produces anything darker than #FAFAFA anywhere on the background it is WRONG."
- W `AVOID` dopisać: „gray background, light gray, silver, off-white, warm white, cool white, studio seamless curve, ambient shadow bleeding into background, gradient from light to slightly darker, any pixel below 250 in R/G/B on the background".
- Zostawić bez zmian klauzulę chroniącą kolor produktu (dodana w poprzedniej iteracji).

### 2. `src/lib/pim/_workers.server.ts` — `buildSeedreamPrompt` (PIM miniaturki masowo)
- Analogiczne zaostrzenie: „flat solid #FFFFFF fill", „identical pixel value in all four corners", „no gradient / no vignette / no seamless curve", „reject any pixel below 250,250,250 on background".

### 3. Lekki post-processing tła po pobraniu z FAL (opcjonalnie, ale zalecane)
W `regen.functions.ts` po `fetchImageBytes(generatedUrl)`, przed zapisem:
- Wykryć piksele tła po krawędziach (np. średnia z 8-pikselowej ramki).
- Jeśli średnia jest >235 ale <255 w każdym kanale, zrobić prosty **level snap**: piksele o luminancji ≥ ~240 i niskim nasyceniu (|max-min| < 8) podnieść do (255,255,255). Produkt (bardziej nasycone lub ciemniejsze piksele) zostaje nietknięty.
- Implementacja bez `sharp`/`canvas` (Worker runtime nie wspiera) — dla JPG/WebP z FAL trzeba by dekodować. Jeśli nie chcemy dokładać zależności działających w workerd, ograniczamy się do samego promptu (punkty 1–2) i tę część pomijamy.

## Rekomendacja

Zacznijmy od samego wzmocnienia promptu (kroki 1 i 2) — to bezinwazyjne i najczęściej wystarcza. Post-processing (krok 3) dodamy, jeśli po testach dalej pojawi się szary odcień.

## Weryfikacja

Po zmianach: w projekcie z tonerem HP 207X kliknąć **Regeneruj ponownie** przy miniaturce — tło powinno być czyste #FFFFFF (rogi kadru = 255,255,255), a kolor produktu bez zmian.

## Poza zakresem

- UI, tabele, jobs, DB, ustawienia projektu — bez zmian.
- Prompt Nano Banana Pro / lifestyle — bez zmian (dotyczy tylko miniaturki na białym).

Czy wystarczy sam wzmocniony prompt (1+2), czy od razu dołożyć post-processing (3)?
