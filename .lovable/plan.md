# Analiza zdjęć produktu przez AI (Gemini) → prompt stylu i wymagań

## Cel

Zanim uruchomimy regenerację miniatury lub wygenerujemy wizualizacje, AI (Gemini multimodalny) przegląda zdjęcia źródłowe produktu i pisze spersonalizowany prompt: styl/scenę oraz wymagania techniczne. Użytkownik widzi wynik w polu tekstowym i może go edytować przed uruchomieniem generacji.

## Model

`google/gemini-2.5-pro` przez Lovable AI Gateway (obsługuje wejście `image_url`, chat completions). Fallback: `google/gemini-3-flash-preview` przy timeoutach.

## Backend

Nowa funkcja RPC w `src/lib/pim/ai.functions.ts`:

```
analyzeProductImagesForPrompt({ productId, mode })
  mode: "thumbnail" | "visualization"
```

Kroki handlera (z `requireSupabaseAuth`):
1. Pobiera `source_products` + `enrichments` (nazwa, marka, kategoria, cechy, `image_urls[]`).
2. Wybiera max 4 najlepsze zdjęcia (pierwsze niepuste, deduplikacja).
3. Buduje wiadomość multimodalną: system prompt zależny od `mode` + user content `[text, image_url, image_url, ...]` (schemat z `ai-multimodal-input`).
4. Wywołuje `POST https://ai.gateway.lovable.dev/v1/chat/completions` z `LOVABLE_API_KEY`.
5. Wymusza JSON: `{ style: string, requirements: string }`.
6. Zwraca do klienta.

System prompty:
- **thumbnail** — AI opisuje co widzi (kolor produktu, materiał, kształt, orientacja), pisze wymagania „zachowaj ten dokładnie ten kolor/materiał/logo, tło #FFFFFF, kąt ~45°" — dopasowane do konkretnego produktu.
- **visualization** — AI proponuje scenę pasującą do kategorii/charakteru produktu (np. „notebook na drewnianym biurku w biurze przy oknie") + wymagania (spójność logo, proporcje, oświetlenie).

## Frontend

### 1. Dialog „Generuj wizualizacje" (`GenerateVisualizationsDialog.tsx`)

Obok istniejącego przycisku „✨ Zaproponuj AI" (tekstowy, na bazie samej nazwy) dodać drugi przycisk **„🔍 Analizuj zdjęcia"** przy każdym z pól Styl/scena i Wymagania. Klik:
- Wywołuje `analyzeProductImagesForPrompt({ productId, mode: "visualization" })` dla pierwszego zaznaczonego produktu.
- Wynik `style` wstawia do pola Styl, `requirements` do pola Wymagania.
- Loading state, disabled gdy brak zaznaczonych produktów lub brak zdjęć.

Toast informacyjny gdy produkt nie ma zdjęć źródłowych.

### 2. Edytor produktu (`projects.$id.products.$pid.tsx`) — sekcja miniatury

W sekcji regeneracji miniatury dodać przycisk **„🔍 Analizuj zdjęcia i zaproponuj prompt"** obok istniejących kontrolek stylu. Klik:
- Wywołuje `analyzeProductImagesForPrompt({ productId, mode: "thumbnail" })`.
- Otwiera modal/rozwija panel z polami `style` i `requirements` do edycji.
- Po akceptacji: przekazuje jako parametry do `regenerateMainImage` (rozszerzenie sygnatury o opcjonalne `customStyle`, `customRequirements`).

`regenerateMainImage` w `src/lib/pim/regen.functions.ts` przyjmuje opcjonalne pola i doklejają je do promptu FAL (przed twardymi ogranicznikami tła #FFFFFF/zakazu zmiany koloru — te zostają nienaruszone jako priorytet).

## Ograniczenia / bezpieczeństwo

- Max 4 zdjęcia × ~1 MB base64 lub podanie jako URL (jeśli publiczne w storage). Preferuj URL — mniejszy payload.
- Timeout 30s (limit Cloudflare Worker). Obsłużyć błędy `402` (kredyty) i `429` (rate limit) toastem.
- Zachowaj istniejące twarde zabezpieczenia w promptach regeneracji (tło #FFFFFF, zakaz zmiany koloru produktu) — AI-generated `requirements` jest dodatkiem, nie zastępuje.

## Pliki do zmiany

- `src/lib/pim/ai.functions.ts` — nowa funkcja `analyzeProductImagesForPrompt`.
- `src/lib/pim/regen.functions.ts` — rozszerzenie sygnatury o `customStyle`/`customRequirements`.
- `src/components/pim/GenerateVisualizationsDialog.tsx` — przyciski „🔍 Analizuj zdjęcia" przy dwóch polach.
- `src/routes/_auth/projects.$id.products.$pid.tsx` — przycisk + panel edycji promptu w sekcji miniatury.

Bez zmian w schemacie DB, bez nowych migracji.
