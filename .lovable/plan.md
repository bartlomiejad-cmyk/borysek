# Wizualizacje produktowe w projektach PIM

Wykorzystujemy silnik z modułu Zdjęcia (Gemini przepisuje PL → EN prompt, FAL `nano-banana-pro/edit` renderuje w 2K/4K), ale wyniki wracają do enrichments PIM i pokazują się w galerii/eksporcie.

## 1. UI — nowy kafelek na stronie projektu

`src/routes/_auth/projects.$id.index.tsx` — dodać kafelek **„Wizualizacje"** (obok CSV / Linki / Firecrawl / Uzupełnij zdjęcia). Klik otwiera nowy dialog `GenerateVisualizationsDialog`.

Dialog (`src/components/pim/GenerateVisualizationsDialog.tsx`), analogicznie do formularza z `photo.$id.tsx`:
- **Zakres** (radio): `Zaznaczone (X)` / `Cały projekt` / `Tylko produkty z gotowym zdjęciem głównym`. Domyślnie: zaznaczone jeśli >0, inaczej „z gotowym zdjęciem głównym".
- **Liczba wizualizacji** (0–8), input numeryczny.
- **Styl / scena** — Textarea, opcjonalny prompt (zapamiętany na projekcie, patrz krok 3).
- **Wymagania (PL)** — Textarea, długi opis co ma być na wizualizacji (Gemini przetłumaczy na EN).
- **Jakość**: RadioGroup 2K / 4K.
- Podsumowanie: „X produktów × N wizualizacji = Y renderów FAL".
- Akcje: Anuluj / Uruchom.

Po submit tworzy bulk_job (`PIM_VISUALIZATIONS`) i zamyka dialog. Postęp/log pokazuje istniejący `BulkJobLog` (dopisujemy nowy `kind` do polleru progresji).

## 2. Backend — nowy worker + serverFn

**Nowy typ bulk_job**: `PIM_VISUALIZATIONS`.

`src/lib/pim/regen.functions.ts` (albo nowy `visualizations.functions.ts`):
- `createVisualizationJob({ projectId, productIds?, scope, count, stylePrompt?, requirementsPl, quality })` → insert do `bulk_jobs` (kind=`PIM_VISUALIZATIONS`, items=lista source_product_id), payload={count, requirementsPl, stylePrompt, targetResolution: 2048/4096}. Kick /api/public/hooks/process-bulk-jobs.
- Rozwiązanie zakresu robimy po stronie serwera (RLS gwarantuje projekt użytkownika): jeśli scope=`all` — pobiera wszystkie enrichments projektu; jeśli `with_main` — tylko te z `regenerated_main_image != null` lub `picked_urls[0]`; jeśli `selected` — używa `productIds`.

`src/lib/pim/_workers.server.ts` — nowa funkcja `runPimVisualization(productId, ctx, payload)`:
1. Pobiera `enrichments` (regenerated_main_image, pinned_main_url, picked_urls, ai_gallery_urls) + `source_products.name`.
2. **Zdjęcie źródłowe** = pierwsze niepuste z: `pinned_main_url` → `regenerated_main_image` (pomijając sentinel `__imported__`) → `picked_urls[0]`. Brak → job item FAILED z komunikatem „brak zdjęcia głównego".
3. Buduje prompty przez wywołanie istniejącego `buildFalPromptsFromPolish` (już eksportowane w tym pliku dla /photo) z inputem `{ productName, description, requirementsPl, projectStyle: payload.stylePrompt, sourceUrls: [main] }`. Bierzemy `lifestyle_prompt` (miniaturkę pomijamy — mamy już packshot).
4. W pętli `i = 0..count-1` woła `callFal("fal-ai/nano-banana-pro/edit", { image_urls: [main], prompt: lifestylePrompt, image_size: {w,h}, num_images: 1, sync_mode: true, output_format: "jpeg" })`. Zapisuje bytes do bucketu `regenerated-images` pod `visualizations/<enrichment.id>-<timestamp>-<i>.jpg`, dostaje public URL.
5. Po pętli aktualizuje `enrichments.ai_gallery_urls = [...existing, ...newUrls]` (append; użytkownik może później schować ręcznie). Emituje log per render (`emit`) — BulkJobLog pokaże progres.

`src/routes/api/public/hooks/process-bulk-jobs.ts` — dispatcher: `case "PIM_VISUALIZATIONS": await runPimVisualization(item, ctx, job.payload)`.

`src/lib/pim/bulk-jobs.functions.ts` — dopisać `PIM_VISUALIZATIONS` do dozwolonych `kind` w `createBulkJob` i w typach `getActiveBulkJob` (żeby UI mógł pytać o aktywne zadanie tego typu).

## 3. Pamięć ustawień

Styl/wymagania niech się zapisują na projekcie żeby nie trzeba było wpisywać za każdym razem. Reużywamy istniejących kolumn `photo_projects` byłoby błędem (to inny moduł). Zamiast tego dokładamy dwie kolumny do `projects`:

- migracja: `ALTER TABLE public.projects ADD COLUMN visualization_style_prompt text, ADD COLUMN visualization_requirements_pl text;` (grants już są dla `projects`).
- `updateProject` w `src/lib/pim/projects.functions.ts` — dopisać do walidatora `visualization_style_prompt` i `visualization_requirements_pl`.
- Dialog na open wczytuje te wartości; „Uruchom" zapisuje je przez `updateProject`, potem tworzy job.

## 4. Widoczność wyników

Wygenerowane URL-e trafiają do `ai_gallery_urls`, więc automatycznie:
- pokazują się w liście produktów (galeria) i w CSV (kolumny `Final_*` dzięki `pickThumbsForList`),
- widok szczegółu produktu (`projects.$id.products.$pid.tsx`) już renderuje galerię — nic nie zmieniamy.

BulkJobLog pokazuje progres. W nagłówku strony (obok progresji Firecrawl/Regen) dodajemy sekcję z aktywnym `PIM_VISUALIZATIONS` (jeden warunek więcej w istniejącym pollerze).

## 5. Bezpieczeństwo i limity

- Walidacja: `count` 0–8, `targetResolution` ∈ {2048, 4096}, `productIds` max 1000, `stylePrompt` ≤ 2000, `requirementsPl` ≤ 4000.
- Wymagane `FAL_KEY` i `LOVABLE_API_KEY` (już istnieją).
- `count = 0` → job kończy się od razu ze statusem DONE (nic nie robi).

## Zakres zmian (pliki)

- **UI**: `src/routes/_auth/projects.$id.index.tsx` (kafelek + wyświetlanie aktywnego joba), `src/components/pim/GenerateVisualizationsDialog.tsx` (nowy).
- **Server fn**: `src/lib/pim/regen.functions.ts` lub nowy `visualizations.functions.ts`, `src/lib/pim/projects.functions.ts`, `src/lib/pim/bulk-jobs.functions.ts`.
- **Worker**: `src/lib/pim/_workers.server.ts` (+ eksport `buildFalPromptsFromPolish` jeśli nie jest jeszcze), `src/routes/api/public/hooks/process-bulk-jobs.ts` (dispatch).
- **Migracja**: dwie kolumny w `public.projects`.

## Uwagi

- Nie tykamy modułu Zdjęcia — logika jest reużywana przez wspólny helper `buildFalPromptsFromPolish` już istniejący w workerze.
- Wygenerowane wizualizacje **dopisują się** do galerii, nie nadpisują istniejących packshotów. Użytkownik może je ukryć istniejącym mechanizmem `hideImageByProduct`.
