
## Problem

Prompty do miniaturek już zakazują beżu/kremu/off-white, ale FAL (seedream v4 edit oraz worker `nano-banana`) i tak zostawia lekko beżową poświatę pod produktem. Sam prompt nie wystarczy — modele generatywne nie dają twardej gwarancji na pojedynczy kolor tła. Trzeba wymusić czystą biel po stronie serwera, deterministycznie.

## Rozwiązanie

Po tym, jak model wygeneruje miniaturę (kwadrat 1:1 na "białym" tle), przepuść wynik przez usuwanie tła i skomponuj RGBA nad płaskim #FFFFFF. To gwarantuje matematycznie czyste tło niezależnie od tego, co zwrócił model.

Dotyczy to dwóch ścieżek generowania miniatur:

1. Ręczna regeneracja z edytora produktu — `regenerateMainImage` w `src/lib/pim/regen.functions.ts`.
2. Masowa regeneracja w workerze — `runRegenerateMainImage` w `src/lib/pim/_workers.server.ts` (ta sama logika, ten sam problem).

## Co dokładnie zmienimy

### 1. Nowy helper `flattenToWhiteBackground` w `src/lib/pim/_workers.server.ts`

- Wejście: `Uint8Array` z wynikiem FAL (JPEG/PNG).
- Krok A: wywołaj `fal-ai/bria/background/remove` (albo `fal-ai/imageutils/rembg` jeśli bria zwraca 4xx) — model zwraca PNG z kanałem alfa (tło = 0).
- Krok B: sparsuj RGBA używając czystego JS (`upng-js` — działa w Cloudflare Worker, nie wymaga sharpa ani canvasa; dodamy `bun add upng-js`).
- Krok C: na nowym buforze RGB zainicjalizuj wszystkie piksele na `(255,255,255)`, następnie dla każdego piksela z alfą > 0 wykonaj kompozyt `dst = src*a + 255*(1-a)`. Wynik: JPEG (kompresja przez upng-js → PNG lub `@cf-wasm/photon` do JPEG; wybierzemy PNG dla prostoty i pewności — brak ryzyka artefaktów JPEG na krawędziach tła).
- Wyjście: `Uint8Array` (PNG z płaskim białym tłem) + wymiary.

Kompresja PNG to prosty pass — pliki i tak rzędu 1–2 MB dla 2560px, w porządku.

### 2. Podpięcie w obu ścieżkach

- `regenerateMainImage` (`src/lib/pim/regen.functions.ts`): po `fetchImageBytes(generatedUrl)`, przed uploadem do Storage, przepuść bajty przez `flattenToWhiteBackground`. Zapisz jako `.png` (nadpisując istniejące `.jpg`/`.webp`).
- `runRegenerateMainImage` (`src/lib/pim/_workers.server.ts`): analogicznie — po pobraniu wyniku FAL, przed uploadem końcowym.

Ścieżka wizualizacji lifestyle (`PIM_VISUALIZATIONS`) NIE jest ruszana — tam tło ma być scenerią, nie białe.

### 3. Uproszczenie promptu miniatury (opcjonalnie)

Skoro tło i tak wymusimy po fakcie, prompt do FAL możemy skrócić — zostawiamy jedno zdanie o białym tle plus twarde reguły dla samego produktu (kolory, logo, framing). Krótszy prompt = mniej driftu modelu na etykietach. To drobne uproszczenie, głównego problemu nie zmienia.

## Fallbacki

- Jeśli usuwanie tła zwróci 4xx/5xx, log + `throw` w workerze (żeby job miał `failed_count`), a `regenerateMainImage` rzuca Toast — użytkownik klika ponownie. Nie zapisujemy "półgotowego" wyniku z beżowym tłem.
- Jeśli `fal-ai/bria/background/remove` będzie problematyczny, alternatywa: `fal-ai/imageutils/rembg` (open-source, tańszy, chwilę wolniejszy). Wybór w helperze, jedna zmienna.

## Runtime

`upng-js` to czysty JS (~30 KB), zero natywnych zależności — bezpieczne dla Cloudflare Worker. Nie potrzebujemy `sharp`/`canvas`/`photon`.

## Weryfikacja

Wygenerować miniaturę z produktu, na którym wcześniej wychodziło beżowe tło (np. Speed-line/Yasuni), i sprawdzić w podglądzie oraz otwierając PNG w narzędziu z pipetą — cztery narożniki muszą być dokładnie `#FFFFFF`.
