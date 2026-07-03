## Cel

Wpoić dobre praktyki generowania zdjęć produktowych w system prompty Gemini→FAL, aby model konsekwentnie chronił logo/tekst, używał języka fotograficznego i nie „zgadywał" etykiet. Bez zmian w UI.

## Zakres — 1 plik

`src/lib/pim/_workers.server.ts`, dwa system prompty:

1. **`buildFalPromptsFromPolish`** (linie 145–163) — prompt do generacji 1 miniaturki + 5 wizualizacji.
2. **`buildFalEditPromptFromPolish`** (linie 1625–1637) — prompt do edycji pojedynczego zdjęcia.

## Zmiany w system prompcie generatora

Do sekcji „PRESERVE" (obie: THUMBNAIL i LIFESTYLE) dodać:

- **Cytat dosłowny etykiet**: instrukcja, żeby model wyciągnął widoczny tekst z referencji i wstawiał go dosłownie w cudzysłowie, np. `preserve label "NAZWA" letter-for-letter, do not paraphrase or invent characters`.
- **Blokada etykiety**: `change only background/scene, keep product, logo, text, colors and proportions EXACTLY the same, preserve style/lighting/textures`.
- **Jakość referencji**: jeśli logo/tekst na źródle jest małe/rozmyte, NIE dorysowuj go — pozostaw taką rozdzielczość i ostrość jak w oryginale, nie „upiększaj" liter.
- **Zakaz rysowania logo od zera**: `never redraw or stylize the logo/brand mark; only reproduce what is visible in the reference`.

Do sekcji „LIFESTYLE PROMPT rules" dodać wymagania **języka fotograficznego** (obowiązkowo w każdej wizualizacji):

- kąt kamery (np. `eye-level 3/4 view`, `low angle`, `top-down flat lay`),
- ogniskowa / głębia ostrości (`50mm, shallow depth of field, background softly blurred`),
- kierunek i temperatura światła (`soft window light from the left, warm 4500K`),
- rozdzielczość / jakość: `sharp product, no motion blur, photorealistic, 4K commercial photography`.

Do sekcji „THUMBNAIL PROMPT rules" dodać: `2K studio quality, sharp, no motion blur, no compression artifacts`.

Reguła META (na końcu system promptu): każda wygenerowana wizualizacja MUSI zawierać co najmniej jedną frazę o kącie kamery, jedną o świetle i jedną o głębi ostrości — inaczej prompt jest niekompletny.

## Zmiany w system prompcie edytora

W `buildFalEditPromptFromPolish` do reguł dodać:

- **Blokada etykiety w edycji**: `Change ONLY what the user's correction requests. Everything else — product, logo, printed text, colors, materials, proportions, framing, lighting on the product — must stay pixel-identical to the input image.`
- **Dosłowność tekstu**: jeśli poprawka nie dotyczy tekstu na produkcie, `never re-render, restyle or re-letter any printed text or logo; treat them as untouchable pixels`. Jeśli dotyczy — cytuj docelowy tekst w cudzysłowie dosłownie.
- **Brak logo od zera**: `do not invent, redraw or embellish any brand mark`.
- Jeśli korekta dotyczy sceny/tła, dodać do promptu frazę fotograficzną (kąt, światło, głębia) zgodną z oryginalnym promptem.

## Bez zmian

- UI (`photo.$id.tsx`), model, koszt, kolejność jobów, retry na 422, cache promptów — bez zmian.
- Fallback prompt na FAL 422 zostaje jak jest (już jest neutralny i bezpieczny).

## Efekt

Model konsekwentnie zachowuje logo/tekst z referencji, nie generuje logo od zera, a wizualizacje mają wymuszony język fotograficzny (kąt + światło + głębia) — co redukuje „generyczne" tła i przekręcone nazwy marek.
