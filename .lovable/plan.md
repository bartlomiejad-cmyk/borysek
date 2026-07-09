## Problem

Pola SEO (Slug, Meta description, Keywords) pozostają puste po kliknięciu **„Generuj z 3 źródeł"** w edytorze produktu, mimo że sam opis się zapisuje.

**Przyczyna** (zdiagnozowana z kodu i bazy):
- Przycisk w UI wywołuje `generateGoldenRecord` z `src/lib/pim/ai.functions.ts` (user-facing server fn).
- Ten handler pyta AI tylko o `{name, description, features}` i zapisuje do bazy tylko te trzy pola.
- Osobna funkcja `runGenerateGoldenRecord` w `src/lib/pim/_workers.server.ts` (używana przez bulk-joby) już umie generować i zapisywać `golden_slug`, `golden_meta_description`, `golden_seo_keywords` — ale nie jest wywoływana z UI produktu.
- Weryfikacja w DB: dla świeżo wygenerowanego produktu „Norma .223 Rem V-MAX" (generated_at = dziś) `golden_description` ma 615 znaków, ale wszystkie trzy pola SEO są `NULL`.

## Fix

Wyrównać user-facing `generateGoldenRecord` do wariantu SEO-aware używanego przez workerów, bez duplikowania logiki.

### Kroki

1. **Nowy plik `src/lib/pim/seo.ts`** — czyste helpery bez zależności serwerowych: `slugifyPl`, `clampName`, `clampMetaDescription`, `dedupeKeywords` + eksportowany `GOLDEN_SEO_SYSTEM_PROMPT` (obecny prompt SEO z `_workers.server.ts`). Plik client-safe, importowalny z każdego miejsca.

2. **`src/lib/pim/_workers.server.ts`** — usunąć lokalne definicje tych helperów i `PL_DIACRITICS`/`SLUG_STOPWORDS`, `import` ich z nowego `./seo`. `GoldenSchema` zostaje. Prompt w `runGenerateGoldenRecord` zastąpić importem `GOLDEN_SEO_SYSTEM_PROMPT` (identyczna treść). Zachowanie workera niezmienione.

3. **`src/lib/pim/ai.functions.ts` → `generateGoldenRecord`**:
   - Rozszerzyć wewnętrzny zod-schema w `callGateway` o `slug`, `meta_description`, `seo_keywords` (wszystkie `.optional().default(...)`).
   - Podmienić `systemPrompt` na `GOLDEN_SEO_SYSTEM_PROMPT` z `./seo`.
   - W `userPrompt` poprosić o pełny JSON z polami SEO.
   - Po parsowaniu: policzyć `slug = slugifyPl(out.slug || name, 75)`, `metaDescription = clampMetaDescription(...)`, `seoKeywords = dedupeKeywords(...)`, `name = clampName(...)` — dokładnie jak worker.
   - Dorzucić do `updatePayload`: `golden_slug`, `golden_meta_description`, `golden_seo_keywords` (`|| null` gdy puste). W `previous` snapshot dołożyć te trzy pola (jak worker).
   - Zwrot z handlera rozszerzyć o `{ slug, metaDescription, seoKeywords }`, żeby ewentualny konsument miał komplet — istniejący caller w `projects.$id.products.$pid.tsx` nie używa returna (odświeża przez `invalidate()`), więc bezpieczne.

Nie ruszamy: UI edytora produktu (formularz już czyta `golden_slug` / `golden_meta_description` / `golden_seo_keywords`), `updateGoldenRecord` (zapis ręczny), workerów, migracji.

### Weryfikacja

Po zbuildowaniu: w projekcie **ammobrak** kliknąć na dowolnym produkcie **„Generuj z 3 źródeł"**, wrócić do zakładki SEO — pola Slug / Meta description / Słowa kluczowe powinny być wypełnione. Sprawdzić też, że stare bulk-joby (`GENERATE_GOLDEN`) nadal działają (worker używa tego samego prompta z `./seo`).

## Detale techniczne

- `seo.ts` bez `"use server"` / dynamicznych importów — czyste TS, bezpieczne w SSR i w bundle klienta.
- `_workers.server.ts` traci ~50 linii (helpery), zyskuje 1 import.
- `ai.functions.ts` traci ~30 linii duplikatu prompta (przechodzi w import), zyskuje ~15 linii SEO-processingu.
- Zmiana kompatybilna wstecz: brakujące pola SEO w odpowiedzi AI schodzą do `""` / `[]` przez `.default(...)`, potem stają się `null` w bazie — tak samo jak w workerze.

## Poza scope

- Backfill istniejących ~64 produktów, które mają `golden_description` ale brak SEO — trzeba by uruchomić dla nich `GENERATE_GOLDEN` powtórnie. Mogę zrobić w osobnej turze (bulk-akcja „Uzupełnij SEO" lub jednorazowe re-generowanie tylko pól SEO bez ruszania opisu).
