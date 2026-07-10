## Problem

Regeneracja głównej miniaturki PIM (Seedream v4 edit) w projekcie **Hurtownia Format** wybieliła okładkę zeszytu „Geografia" — produkt zmienił kolor z zielonego na biały. Powód: prompt `buildSeedreamPrompt` w `src/lib/pim/_workers.server.ts` bardzo mocno wymusza białe tło (`PURE WHITE #FFFFFF`, „BRIGHTER and WHITER", „AVOID: cream/beige/…/gray background"), ale ochronę koloru produktu ma tylko w jednej krótkiej wzmiance („Keep every … color …"). Model interpretuje „whiter" jako polecenie dotyczące całego kadru i wybiela też sam produkt.

Ten sam wzorzec występuje w promptcie edycji AI (`buildFalPromptsFromPolish`) — kolor jest wspomniany, ale nie chroniony jednoznacznie.

## Zmiany (tylko backend, prompty)

Plik: `src/lib/pim/_workers.server.ts`

### 1. `buildSeedreamPrompt` (miniaturka + galeria PIM)
- Rozdzielić „białe tło" od „produkt": pierwsza linia dotyczy tylko tła, dodać jawną klauzulę, że biel dotyczy **wyłącznie** tła seamless, a nie powierzchni produktu.
- Dodać nową linię `CRITICAL COLOR`:
  - „Preserve the product's own colour(s) pixel-faithfully. Do NOT desaturate, whiten, lighten, brighten or shift hue/tone of the product body, cover, packaging or any printed graphic. If the source product is green, the output stays that exact green; same for any other colour."
- W linii `PRESERVE` przenieść `color` z ogólnej listy na początek i pogrubić językowo („colour EXACTLY as in the source, including saturation and tone").
- W linii `AVOID` dopisać: „whitened / desaturated / bleached product body, colour drift, product tinted to match the background".
- W obu zdaniach `SUBJECT` / `COMPOSITION` doprecyzować: „the product retains its original colour(s) — only the surroundings become pure white".

### 2. `buildFalPromptsFromPolish` (thumbnail + lifestyle w module Zdjęcia / PIM wizualizacje)
- Do reguł `THUMBNAIL PROMPT` i `LIFESTYLE PROMPT` dopisać osobny punkt:
  - „Preserve the product's own colour(s) letter-for-letter — never whiten, desaturate, bleach or shift hue. Background changes to pure white/scene, product colours stay identical to the reference."
- Doprecyzować istniejący punkt o zachowaniu labeli/logo: dodać „colours (hue, saturation, tone)" tuż obok „label, logo, material".
- Dopisać META RULE: „Both prompts MUST contain an explicit sentence forbidding any colour change on the product itself."

### 3. (Opcjonalnie) `fallbackPrompts`
- Jeśli funkcja fallbacku ma statyczny szablon, zaktualizować analogicznie, żeby ścieżka awaryjna też chroniła kolor.

## Weryfikacja

Po zmianach: w projekcie „Hurtownia Format" na produkcie „Zeszyt A5 60 M 70g UV Geografia" kliknąć **Regeneruj ponownie** przy miniaturce — zielona okładka powinna zostać zachowana, zmienia się tylko tło i ewentualnie propsy.

## Poza zakresem

- UI, tabele, jobs, DB, ustawienia projektu — bez zmian.
- Ustawienia AI (Komponent A/B, padding, custom style) — bez zmian; działamy wyłącznie na treści promptów wysyłanych do FAL.