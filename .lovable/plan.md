## Problem

Generowanie „Złotego Rekordu" pada z Zod: `features[*] Expected object, received string`. Model (Gemini) zwrócił `features` jako tablicę stringów (np. `"Kaliber: G4"`) zamiast `{key, value}`, więc `schema.parse` w `callGateway` (src/lib/pim/ai.functions.ts, linie 79–92) rzuca i przerywa cały flow.

To samo dotyczy `regenerateFeatures` (linia 296) — ten sam kształt schematu, ten sam problem, gdy model odpowie stringami.

## Fix

1) W `src/lib/pim/ai.functions.ts` dodać helper `coerceFeatures(input: unknown): Array<{key,value}>`:
   - Jeżeli element jest obiektem z `key`+`value` → zostaw.
   - Jeżeli string zawiera `":"` → split na pierwszym `":"`, trim → `{key, value}`.
   - Jeżeli string bez `":"` → `{key: "Cecha", value: trim}` (lub odrzuć jeśli pusty).
   - Nie-tekst/nie-obiekt → odrzuć.
   - Ograniczyć długości do limitów schematu (200 / 2000), max 60.

2) W `callGateway` (linia 79) przed `schema.parse` znormalizować: `parsed.features = coerceFeatures(parsed.features)`. Schemat pozostaje strict (waliduje po koercji) — brak regresji dla poprawnych odpowiedzi.

3) W `regenerateFeatures` (linia ~354) analogicznie znormalizować `out.features` przed użyciem (albo przed parsem, jeśli używa tego samego schematu).

4) Wzmocnić prompt: w `GOLDEN_SEO_SYSTEM_PROMPT` (src/lib/pim/seo.ts, sekcja FEATURES ok. linii 169) dopisać jedno krótkie zdanie: „features MUSI być tablicą OBIEKTÓW `{\"key\": string, \"value\": string}` — NIE stringów typu 'Klucz: wartość'." (miękka bariera; twarda to koercja).

5) Log: jeśli po koercji którykolwiek element został odrzucony/naprawiony, `console.warn("[golden] features coerced", { before, after })` — bez błędu użytkownikowi.

Brak zmian bazy, brak zmian UI. Ryzyko regresji minimalne — koercja tylko rozszerza akceptowany input.

## Walidacja

- Ponownie wygenerować Złoty Rekord dla produktu z zrzutu — powinno przejść bez błędu Zod, a `golden_features` mieć poprawne pary klucz/wartość.
- Typecheck czysty.
