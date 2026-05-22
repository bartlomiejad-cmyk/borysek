# Plan: 4 ulepszenia eksportu i miniatur

## 1. Eksport CSV — cechy w osobnych kolumnach

**Plik:** `src/lib/pim/export.functions.ts`

Obecnie cechy lecą jako `features_text` (połączony string) i `features_json` (JSON). Rozdzielimy je na osobne kolumny per cecha (`cecha_<klucz>`).

- Pierwsze przejście po wszystkich produktach: zebrać unikalny zbiór kluczy cech w całym projekcie, posortowany alfabetycznie (stabilna kolejność kolumn między wierszami).
- Drugie przejście: dla każdego wiersza dodać klucze `cecha_<klucz> = wartość` (pusty string jeśli produkt nie ma danej cechy).
- Zachowujemy `features_text` (czytelny podgląd) dla wstecznej kompatybilności. Usuwamy `features_json`.
- Normalizacja kluczy: trim + zamiana białych znaków i `;` na `_`, żeby nie psuły CSV/nagłówków Excela.

Frontend (`Papa.unparse` / `XLSX.utils.json_to_sheet`) działa bez zmian — sam wykryje nowe pola.

## 2. Regeneracja FAL → zawsze JPG

**Plik:** `src/lib/pim/regen.functions.ts`

- W requeście do `seedream/v4/edit` dodajemy `output_format: "jpeg"` (Seedream wspiera ten parametr; przy braku wsparcia po prostu fall-backniemy na konwersję w kroku 2).
- Po pobraniu wyniku z FAL: jeśli `detectImageFormat` zwróci coś innego niż `jpg`, konwertujemy bajty na JPG przed uploadem. Konwersję robimy na poziomie Workera bez native deps:
  - WebP/PNG → JPG: użycie WASM-owego dekodera/enkodera kompatybilnego z Cloudflare Workers (np. `@jsquash/webp` + `@jsquash/png` + `@jsquash/jpeg`). To czyste WASM, zgodne z naszym runtime.
  - Quality 92, białe tło (flatten alfa na #FFFFFF, żeby PNG z przezroczystością nie dawały czarnego tła w JPG).
- Wymuszamy nazwę pliku `${enrichmentId}.jpg` i `content-type: image/jpeg`. Czyścimy stare warianty `.webp`/`.png`/`.jpg` przed uploadem (już mamy ten kod — zostaje).
- Aktualizujemy UI label w `projects.$id.products.$pid.tsx`: "Białe tło, miękki cień, produkt ~70% kadru, JPG 2560×2560".

## 3. Eksport CSV — URLe zdjęć AI

**Plik:** `src/lib/pim/export.functions.ts`

Obecnie `image_1..3` i `images_all` zawierają tylko scrapowane URLe (z dopisanym na froncie regenerowanym). Dodajemy osobne kolumny dla zdjęć AI:

- `ai_image_main` — `regenerated_main_image` (URL do JPG w buckecie `regenerated-images`), pusty jeśli brak.
- (opcjonalnie pod kątem przyszłości — zostawiamy puste sloty `ai_image_2`, `ai_image_3` nieprawda, NA RAZIE TYLKO `ai_image_main`, żeby nie generować pustych kolumn).
- Kolumny scrapowane (`image_1..3`, `images_all`) zostają bez zmian, ale **przestajemy wymuszać regen na początku** — `image_1` ma być oryginalnym najlepszym zdjęciem ze źródeł, a AI ma własną kolumnę. Sklep importujący CSV decyduje, którego użyć.

## 4. Lepsza logika miniatury — preferuj pudełko + naboje razem

**Pliki:**
- `src/lib/pim/ai.functions.ts` (prompt + schema)
- `src/lib/pim/images.ts` (sortowanie do eksportu)
- `src/routes/_auth/projects.$id.products.$pid.tsx` (`scoreFor`)

Dodajemy trzeci wymiar AI `has_packaging` (0–10) obok `is_central` i `is_clean`:

- Schema Zod w `ai.functions.ts` dostaje pole `has_packaging: z.number().min(0).max(10)` (z migracją wstecz: jeśli stare wpisy go nie mają, traktujemy jako 0 i nie psujemy istniejących dopasowań).
- Prompt do gemini: `"has_packaging: 10 = widoczne i pudełko/opakowanie i sama amunicja/produkt w jednym kadrze; 6-9 = widać tylko pudełko z grafiką produktu; 3-5 = tylko sam produkt bez opakowania; 0-2 = brak kontekstu produktu."`
- Wzór scoringu zmienia się z `(is_central + is_clean) * area` na `(is_central + is_clean + 1.5 * has_packaging) * area`. Waga 1.5 nadaje "combo pudełko+produkt" przewagę, ale nie przebije totalnego śmiecia.
- `is_banner_or_trash = true` nadal zeruje score.
- Aktualizujemy renderowanie miniatury — dodajemy badge `P {has_packaging}/10` obok `C` i `T`.
- W `images.ts` (export `pickImages`) sortowanie również używa `has_packaging`, jeśli dostępne w `image_meta`/scores. (Wymaga przekazania `image_scores` do `pickImages` — rozszerzamy sygnaturę i call site w `export.functions.ts`).

**Migracja istniejących scores:** brak migracji DB — `image_scores` to JSONB, stare wpisy bez `has_packaging` będą traktowane jako 0. Użytkownik może wymusić ponowną analizę usuwając wpis (już istnieje flow) albo poczekać aż top-4 się zmieni.

## Detale techniczne

- `@jsquash/*` pakiety: `bun add @jsquash/jpeg @jsquash/png @jsquash/webp`. Każdy z nich ma builda Workers-compatible (WASM inlined). Dodać try/catch — jeśli inicjalizacja WASM zawiedzie, raportujemy "Konwersja JPG nieudana, zapisuję oryginał" i lecimy z plikiem jaki dostaliśmy z FAL.
- Wszystkie zmiany backendowe to istniejące `createServerFn` — bez nowych edge functions, bez migracji DB.
- Zmiany w `image_scores` są addytywne (nowy klucz w JSONB), zgodne z RLS.

## Pliki do zmiany

- `src/lib/pim/export.functions.ts` — dynamiczne kolumny cech, `ai_image_main`, brak wymuszania regen jako image_1, sortowanie z `has_packaging`.
- `src/lib/pim/regen.functions.ts` — output JPG + konwersja WASM.
- `src/lib/pim/ai.functions.ts` — nowy wymiar `has_packaging` w prompt + Zod schema.
- `src/lib/pim/images.ts` — rozszerzona sygnatura `pickImages` o scores.
- `src/routes/_auth/projects.$id.products.$pid.tsx` — `scoreFor` z `has_packaging`, badge `P x/10`, label "JPG".
- `package.json` — dependency `@jsquash/*`.
