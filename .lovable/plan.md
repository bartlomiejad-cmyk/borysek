## Cel

1. Ustalić stałą liczbę: **1 miniaturka + 5 wizualizacji** (niezależnie od liczby zdjęć źródłowych).
2. Dodać **edycję pojedynczego zdjęcia promptem PL** — po najechaniu na miniaturkę lub wizualizację pojawia się przycisk „Edytuj", który otwiera pole tekstowe; wpisany po polsku opis poprawki jest tłumaczony przez Gemini na prompt EN i wysyłany do `fal-ai/nano-banana-pro/edit` z aktualnym zdjęciem jako referencją. Wynik podmienia to konkretne zdjęcie.

## Zmiany

### 1. Stała liczba wariantów (1 + 5)

- `src/lib/pim/_workers.server.ts` → `runPhotoToolGenerate`: usuwam logikę „gdy zdjęć > 1, wariantów = N−1". Zawsze `variants = 5`, jeden request na miniaturkę + 5 na wizualizacje. Wszystkie zdjęcia źródłowe pozostają jako referencje w `image_urls`.
- `src/routes/_auth/photo.$id.tsx`: usuwam z panelu ustawień pole „Wizualizacje na produkt" oraz krótką notkę. Zostaje tylko styl sceny + „Wymagania (PL)".
- `src/lib/photo-tool/photo-tool.functions.ts`: `updatePhotoProject` przestaje przyjmować `variants_per_product` (albo ignoruje). Kolumna w bazie zostaje (bez migracji), po prostu nieużywana.

### 2. Edycja pojedynczego zdjęcia promptem

**Backend**

- Nowa server function `editPhotoImage` w `src/lib/photo-tool/photo-tool.functions.ts`:
  - input: `{ photoProductId, slot: "thumbnail" | "lifestyle", lifestyleIndex?: number, requirementsPl: string }`
  - waliduje własność (RLS przez `requireSupabaseAuth`)
  - kolejkuje nowy `bulk_job` typu `PHOTO_TOOL_EDIT_IMAGE` z payloadem `{ photoProductId, slot, lifestyleIndex, requirementsPl }`
- Nowy wariant enuma `bulk_job_kind`: `PHOTO_TOOL_EDIT_IMAGE` (migracja `ALTER TYPE ... ADD VALUE`).
- Nowy worker `runPhotoToolEditImage` w `src/lib/pim/_workers.server.ts`:
  1. Pobiera `photo_products` (nazwa, opis, aktualny `thumbnail_url` / `lifestyle_urls[i]`, `generated_thumb_prompt` / `generated_lifestyle_prompt` jako kontekst „poprzedniego promptu").
  2. Woła nowy helper `buildFalEditPromptFromPolish` (Gemini 3.1 Pro) — wejście: nazwa produktu, opis, oryginalny prompt EN dla tego slotu, wytyczne PL od użytkownika; wyjście: pojedynczy prompt EN dla `fal-ai/nano-banana-pro/edit`, zachowujący wierność produktowi i uwzględniający poprawkę.
  3. Woła `callFal("fal-ai/nano-banana-pro/edit", { prompt, image_urls: [<edytowane zdjęcie>], aspect_ratio: "1:1", resolution: "2K", output_format: "jpeg", num_images: 1 })`. Jako referencję używam **tylko edytowanego zdjęcia** (nie surowych źródeł) — to jest edycja istniejącego wyniku.
  4. Zapisuje wynik pod `photo-tool/{projectId}/{productId}/thumb.jpg` (nadpisując miniaturkę) lub `lifestyle_{i}.jpg` (nadpisując konkretną wizualizację), aktualizuje URL w bazie.
  5. Loguje postęp w `bulk_job_events`.
- Rozszerzenie dispatchera `src/routes/api/public/hooks/process-bulk-jobs.ts` o `case "PHOTO_TOOL_EDIT_IMAGE"`.
- Realtime na `photo_products` już włączone → UI odświeży się automatycznie; polling co 2s już działa.

**Frontend — `src/routes/_auth/photo.$id.tsx`**

- Wydzielenie komponentu `PhotoImageCard` renderującego pojedyncze zdjęcie (miniaturka lub wizualizacja):
  - Overlay pojawiający się na `group-hover` z przyciskiem **„Edytuj promptem"**.
  - Kliknięcie otwiera `Dialog` (shadcn) z:
    - podglądem aktualnego zdjęcia
    - `Textarea` „Co poprawić? (po polsku)" — np. „usuń liście z lewej strony, dodaj drewniany blat"
    - przyciskiem „Wygeneruj poprawkę" → `editPhotoImage` mutation
  - Po submicie: dialog zamyka się, na kaflu pokazuje się overlay „Edytuję…" (spinner) dopóki job aktywny; log pojawia się w istniejącym `BulkJobLog`.
- Blok „Prompty EN" pod produktem dostaje trzeci wpis: ostatnio użyty prompt edycji (opcjonalnie, jeśli jest — wymaga dodania kolumny `last_edit_prompt` do `photo_products`, lub prościej: pokazujemy prompt tylko w logu joba).

### 3. Migracje bazy

Jedna migracja:

```sql
ALTER TYPE public.bulk_job_kind ADD VALUE IF NOT EXISTS 'PHOTO_TOOL_EDIT_IMAGE';
```

Nic więcej — reużywamy `bulk_jobs`, `bulk_job_events`, `photo_products.thumbnail_url` i `lifestyle_urls`.

## Szczegóły techniczne dla programisty

- **Prompt Gemini dla edycji** (`buildFalEditPromptFromPolish`) trzyma te same zasady wierności produktowi co obecny generator, ale otrzymuje dodatkowo „ORIGINAL PROMPT" (żeby wiedział co było tłem) i „USER CORRECTION (PL)". Zwraca pojedynczy string `edit_prompt`. Fallback: łączy oryginalny prompt + `EXTRA CORRECTION (translated from Polish): <...>`.
- **Storage upsert**: `upload(..., { upsert: true })` zastąpi plik; do URL doklejam `?v=${Date.now()}` żeby wymusić refresh w `<img>`.
- **Cache promptów** dla generacji (`prompt_source_hash`) zostaje bez zmian; edycja nie modyfikuje `generated_thumb_prompt` / `generated_lifestyle_prompt`, bo to ma być jednorazowa poprawka na tym konkretnym zdjęciu, a nie zmiana promptu bazowego (jeśli userowi ma się zmienić baza — edytuje pole „Wymagania (PL)" na projekcie i klika „Generuj" jeszcze raz).
- **Kolejność w UI**: kafle miniaturki i wizualizacji renderują ten sam komponent `PhotoImageCard` z propem `slot`.

## Efekt

- Zawsze 6 zdjęć na produkt (1 + 5).
- Każde zdjęcie ma na hoverze przycisk edycji → dialog → wpisujesz po polsku co poprawić → Gemini pisze prompt → FAL edytuje → wynik podmienia się w tym samym slocie.
- Reszta workflow (generowanie od zera, log jobów, cache promptów bazowych) bez zmian.
