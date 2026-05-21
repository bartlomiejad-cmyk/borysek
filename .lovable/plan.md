# Regeneracja zdjęcia głównego przez FAL.ai

## Co dostajemy

W panelu produktu pojawia się nowy przycisk **„Regeneruj zdjęcie główne (FAL.ai)"** obok kafelka oznaczonego koroną *Główne*. Po kliknięciu:

1. Bierzemy aktualnie wyłonione zdjęcie główne (`mainUrl` — to samo, które AI oznaczyło koroną).
2. Wysyłamy je do FAL.ai. Model otrzymuje instrukcję:
   - usunąć tło, jeśli nie jest białe,
   - umieścić produkt na czystym białym tle z delikatnym, miękkim cieniem pod produktem,
   - wykadrować tak, aby produkt zajmował ok. 70% powierzchni,
   - wyjście: kwadrat 2560×2560 px, format **WebP**.
3. Wynik zapisujemy w buckecie Supabase Storage i podpinamy do produktu jako „zdjęcie główne po regeneracji".
4. W UI nowy obraz pojawia się jako pierwszy kafelek (z plakietką *Regenerowane*), z opcją *Cofnij* (usuwa regenerowaną wersję i wraca do oryginału).
5. Regenerowana wersja jest też używana w eksporcie CSV — trafia na pierwszą pozycję listy zdjęć produktu.

## Wymagany sekret

- `FAL_KEY` — klucz API z [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys). Po zatwierdzeniu planu poproszę o niego osobnym promptem (bezpieczny formularz). Trzymany wyłącznie po stronie serwera.

## Bucket na regenerowane zdjęcia

- Nowy publiczny bucket `regenerated-images` (publiczny tylko do odczytu — żeby URL działał w eksporcie i podglądzie). Zapis tylko z serwera (service role).

## Zmiany w bazie

Migracja dodaje do tabeli `enrichments` jedną kolumnę:

- `regenerated_main_image` (tekst, opcjonalna) — publiczny URL pliku WebP w buckecie `regenerated-images`. `NULL` = brak regeneracji.

Nie zmieniamy istniejących polityk dostępu — kolumna dziedziczy obecne RLS na `enrichments`.

## Szczegóły techniczne (dla mnie)

### Endpoint FAL

Używamy **`fal-ai/bria/product-shot`** (dedykowany model „product photography" — sam usuwa tło, dodaje białe tło + delikatny cień, kadruje produkt). Wywołanie HTTP REST przez kolejkę FAL:

```text
POST https://queue.fal.run/fal-ai/bria/product-shot
Authorization: Key ${FAL_KEY}
{
  "image_url": "<mainUrl>",
  "scene_description": "clean pure white studio background with a soft subtle shadow under the product",
  "placement_type": "manual_padding",
  "manual_padding_inches": [0.6, 0.6, 0.6, 0.6],   // produkt ~70% kadru
  "num_results": 1,
  "sync_mode": true
}
```

Fallback gdy `bria/product-shot` zwróci błąd / pusty wynik: **`fal-ai/nano-banana/edit`** z promptem opisującym efekt (białe tło, miękki cień, produkt 70% kadru).

### Normalizacja do 2560×2560 WebP

FAL nie gwarantuje dokładnych 2560×2560 ani WebP. Po otrzymaniu URL-a wyniku:

1. Pobieramy bajty (`fetch`) w server function.
2. Konwersja + resize przez **`fal-ai/imageutils/image-conversion`** (lub `imageutils/resize`) z parametrami `width: 2560, height: 2560, format: "webp", fit: "contain", background: "#ffffff"`. To trzyma nas w środowisku Workerów (brak `sharp`).
3. Pobieramy znormalizowany plik i wgrywamy do bucketu `regenerated-images` jako `{enrichmentId}.webp` (nadpisujemy przy ponownej regeneracji).
4. Zapisujemy publiczny URL w `enrichments.regenerated_main_image`.

### Server functions (`src/lib/pim/regen.functions.ts`)

- `regenerateMainImage({ productId })` — middleware `requireSupabaseAuth`. Wykonuje krok FAL → normalizacja → upload → update DB. Zwraca `{ url }`. Obsługuje błędy FAL (401, 429, 5xx) — czytelne komunikaty po polsku przez `toast`.
- `clearRegeneratedImage({ enrichmentId })` — usuwa plik z bucketu i czyści kolumnę.

### UI (`src/routes/_auth/projects.$id.products.$pid.tsx`)

- Nowy przycisk *„Regeneruj zdjęcie główne"* w sekcji *Złoty Rekord*, aktywny gdy `mainUrl` istnieje. Spinner „Generuję zdjęcie produktowe…" podczas trwania (model bywa wolny — 10–40 s).
- Jeżeli `enrichment.regenerated_main_image` jest ustawiony: dodatkowy duży kafelek na samej górze listy źródeł z plakietką *Regenerowane (FAL)* + przyciskiem *Cofnij*. Ten URL otrzymuje też koronę *Główne* zamiast oryginału.

### Eksport

W `export.functions.ts` (funkcja składająca listę zdjęć): jeżeli `regenerated_main_image` jest ustawiony, wstawiamy go na pozycję 0 listy `images` w CSV; oryginał zostaje na dalszych pozycjach.

### Co NIE wchodzi w zakres

- Regeneracja zdjęć innych niż główne.
- Batch / „regeneruj wszystkie produkty" — pojedynczy produkt na raz.
- Edycja promptu z UI — prompt jest stały (zgodny z wymaganiami).

## Kolejność wykonania

1. Migracja DB + bucket Storage (po Twojej akceptacji).
2. Poproszę o `FAL_KEY`.
3. Server functions + UI + integracja z eksportem.
4. Test ręczny na 1 produkcie.
# Ocena kompozycji zdjęć przez AI (Gemini vision)

Cel: zanim weryfikator zobaczy zdjęcia produktu, AI ocenia kompozycję 4 największych zdjęć, liczymy `Score` łączący ocenę z rozdzielczością, sortujemy listę, podświetlamy najlepsze jako "Zdjęcie Główne" i pokazujemy badge'y `is_central` / `is_clean`. Fallback bez blokady: sort po pikselach.

Zamiast OpenAI `gpt-4o-mini` używamy Lovable AI Gateway z modelem `google/gemini-2.5-flash-lite` (vision, tani, szybki — odpowiednik "detail: low"). Sekret: `LOVABLE_API_KEY` (już skonfigurowany), bez `OPENAI_API_KEY`.

## Ważna uwaga techniczna (do akceptacji)

Stack projektu (TanStack Start na Cloudflare Worker) jako warstwę backendu używa `createServerFn`, nie Supabase Edge Functions. Zgodnie z konwencjami repo proponuję zaimplementować logikę jako **`createServerFn` w `src/lib/pim/ai.functions.ts`** (nowa funkcja `analyzeProductImages`) zamiast nowej Edge Function. Korzyści: jeden runtime, ten sam auth/RLS, brak osobnego deploya, te same logi.

Jeśli wolisz mimo to klasyczną Supabase Edge Function `analyze-product-images` — daj znać przy zatwierdzaniu, podmienię krok 1 na wariant Deno (`supabase/functions/analyze-product-images/index.ts`). Reszta planu pozostaje bez zmian.

## Co dostaje użytkownik

- Panel weryfikacji produktu otwiera się ze spinnerem "AI analizuje kompozycję zdjęć…".
- Po analizie zdjęcia są posortowane wg `Score`, najlepsze ma zieloną ramkę z etykietą "Zdjęcie Główne".
- Na każdej miniaturze badge'y: `Centralne X/10`, `Czyste X/10`. Banery/śmieci mają badge "Baner/śmieć" i lądują na końcu (Score = 0).
- Awaria OpenAI ≠ blokada — fallback sortuje wyłącznie po `width * height` i pokazuje dyskretny komunikat "Sortowanie po rozdzielczości (AI niedostępne)".

## Krok 1 — Backend (`analyzeProductImages` server function)

Nowa funkcja w `src/lib/pim/ai.functions.ts`:

- Wejście: `{ productId: string, urls: string[] }` (urls ograniczone do max 4 największych — wybór po `image_meta` po stronie klienta).
- Middleware: `requireSupabaseAuth` (RLS).
- Sekret: `LOVABLE_API_KEY` (`process.env`, czytany wewnątrz `.handler()`).
- Model: `google/gemini-2.5-flash-lite` (vision) przez Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`, header `Lovable-API-Key`). Reużywamy istniejącego `callGatewayRaw` z `ai.functions.ts`.
- Strukturalne wyjście per zdjęcie (`response_format: { type: "json_object" }` + walidacja Zod):
  ```json
  { "is_central": 1-10, "is_clean": 1-10, "is_banner_or_trash": boolean }
  ```
- System prompt: "Jesteś ekspertem e-commerce. Oceń kompozycję zdjęcia pod kątem przydatności jako główna miniaturka produktu w sklepie. Zwróć surowy JSON według podanego schematu."
- Równoległe wywołania `Promise.allSettled` (4 obrazki). Per-image timeout 15s.
- Zapis wyników do `enrichments.image_scores` (nowa kolumna JSONB, mapa `{ [url]: { is_central, is_clean, is_banner_or_trash, scored_at } }`). Cache: jeśli wynik dla URL już istnieje, nie wołamy OpenAI ponownie.
- Zwrot: `{ scores: { [url]: {...} }, source: "ai" | "cache" | "partial" }`. Błąd całościowy → throw (klient zrobi fallback).

## Krok 2 — DB migration

- `ALTER TABLE public.enrichments ADD COLUMN image_scores JSONB NOT NULL DEFAULT '{}'::jsonb;`
- Bez zmian RLS (polityka `en via project` pokrywa kolumnę).

## Krok 3 — Sekret

- `LOVABLE_API_KEY` jest już skonfigurowany w projekcie — żaden nowy sekret nie jest potrzebny.

## Krok 4 — Frontend (panel produktu)

Plik: `src/routes/_auth/projects.$id.products.$pid.tsx`.

- Po załadowaniu produktu i odczytaniu `picked_urls` + `image_meta` + `image_scores`:
  1. Wybierz top-4 wg `width * height` z `image_meta` (z pominięciem `hidden_images`).
  2. Jeśli któryś z 4 URL-i nie ma wpisu w `image_scores` → wywołaj `analyzeProductImages({ productId, urls: brakujące })`. W trakcie: spinner overlay "AI analizuje kompozycję zdjęć…".
  3. Po sukcesie zaktualizuj cache React Query (refetch produktu lub merge lokalny).
- Obliczenie `Score` dla każdego URL z `picked_urls`:
  - jeśli brak `image_meta[url]` → traktuj wymiary jako 0×0,
  - jeśli `is_banner_or_trash === true` → `score = 0`,
  - inaczej → `score = (is_central + is_clean) * width * height`,
  - jeśli brak wpisu w `image_scores` (np. spoza top-4 albo fallback) → `score = width * height` (sam rozmiar).
- Sortuj malejąco po `score`.
- Pierwsza miniatura (najwyższy `score > 0`) dostaje zieloną ramkę `ring-2 ring-emerald-500` + badge "Zdjęcie Główne".
- Na każdej miniaturze:
  - badge `Centralne {is_central}/10` (kolor wg progu: ≥8 zielony, 5–7 żółty, <5 czerwony — tokeny z `styles.css`),
  - badge `Czyste {is_clean}/10` z tą samą skalą,
  - jeśli banner/trash → badge "Baner/śmieć" (destructive).
- Obsługa błędu wywołania: try/catch wokół `analyzeProductImages`, na catch zapamiętaj `aiUnavailable = true`, sortuj po samym `width*height`, pokaż mały tekst pod nagłówkiem listy.

## Krok 5 — Powiązanie z istniejącym `verifySources`

- `verifySources` (watermark / size filter) pozostaje bez zmian — działa wcześniej, hard-excluduje znaki wodne i karmi `image_meta`.
- `analyzeProductImages` jest niezależny i działa **na żywo w panelu** (na żądanie), nie w batch'u "Generuj złote rekordy". To trzyma koszty pod kontrolą (tylko produkty otwarte do weryfikacji).

## Pliki do zmiany

- `supabase/migrations/<timestamp>_add_image_scores.sql` — nowa kolumna.
- `src/lib/pim/ai.functions.ts` — nowy `analyzeProductImages`.
- `src/lib/pim/queries.functions.ts` — dorzucenie `image_scores` do selecta produktu.
- `src/integrations/supabase/types.ts` — regeneracja po migracji.
- `src/routes/_auth/projects.$id.products.$pid.tsx` — spinner, wywołanie, sort, badge, ramka, fallback.

## Poza zakresem

- Brak zmian w eksporcie CSV (kolejność tam nie jest istotna; w razie potrzeby dorobimy w osobnym ticketcie).
- Brak zmian w masowym "Generuj złote rekordy".
- Brak zmian w scrapingu / matchingu / auth.
# Flow: Dopasuj → Generuj złote rekordy (weryfikacja zdjęć + generacja z cechami)

## Cel

Po dopasowaniu (`Dopasuj`) klik w `Generuj złote rekordy` ma dla każdego produktu z dopasowaniem:
1. Zweryfikować zdjęcia ze źródeł (watermark, niezgodność z produktem, rozmiar).
2. Następnie wygenerować złoty rekord (nazwa + opis + cechy) z opisów źródeł.

## Reguły dla zdjęć (wyświetlanie + CSV/XLSX export)

1. **Priorytet ≥ 600×600 px**: w pierwszej kolejności ładowane i eksportowane są zdjęcia o min(width, height) ≥ 600 px, posortowane od największego. Mniejsze są pomijane.
2. **Fallback „jedyne zdjęcie"**: jeżeli dla produktu nie ma żadnego zdjęcia ≥ 600×600, używamy największego dostępnego — żeby produkt nie został bez miniatury/eksportu.
3. **Watermark = twardy wyklucz**: zdjęcia oznaczone przez AI jako zawierające znak wodny / logo cudzego sklepu są wykluczone z wyświetlania i z eksportu CSV/XLSX. Reguła „jedyne zdjęcie" NIE dotyczy watermarków — lepiej brak zdjęcia niż logo obcego sklepu.
4. Reguły obowiązują wszędzie: lista produktów, szczegóły, widok weryfikacyjny, eksport.

## Zmiany

### 1. `src/lib/pim/ai.functions.ts` — nowa `verifySources`

Funkcja `verifySources({ productId })` wywoływana PRZED generacją:
- pobiera `picked_urls` + `images` (+ `extra_images` jeśli włączone) z `product_sources`,
- **pomiar rozmiaru zdjęć**: `fetch` z `Range: bytes=0-65535` + parser nagłówków JPEG/PNG/WebP (bez `sharp`/`canvas` — niedostępne w Workerze). Wynik zapisywany do `enrichments.image_meta` (`{ [url]: { w, h } }`). Cache w pamięci procesu w trakcie bulku. Nieudany pomiar = „nieznany rozmiar" (nie blokuje).
- pyta model wizyjny (Gemini 2.5 Flash) o URL-e: (a) z watermarkiem/logo sklepu, (b) niepasujące do produktu (na podstawie nazwy/EAN/kodu),
- dopisuje URL-e watermarków i niezgodnych do `enrichments.hidden_images` (twardy wyklucz, deduplikacja),
- NIE zapisuje małych zdjęć do `hidden_images` — filtrowanie po rozmiarze odbywa się przy odczycie, dzięki czemu fallback „jedyne zdjęcie" działa per kontekst,
- zapisuje raport do `enrichments.quality`.

### 1a. Warstwa odczytu — wspólny helper `pickImages`

`pickImages(urls, meta, hidden)` używany przez `queries.functions.ts` (lista + detail), widok weryfikacyjny i `export.functions.ts`:
1. Odrzuć URL-e z `hidden` (watermark/niezgodne) — bez wyjątków.
2. Z pozostałych: jeżeli istnieją zdjęcia ≥ 600×600 — zwróć tylko je, posortowane malejąco po `w*h`.
3. W przeciwnym razie — zwróć największe dostępne (po `w*h`; jeżeli żaden nie ma znanego rozmiaru — pierwsze) jako jedyne zdjęcie.
4. Lista produktów limituje do 8 miniatur; eksport bierze wszystkie wybrane.

### 2. `generateGoldenRecord` — bez zmian

Już generuje nazwę + opis + cechy w jednym callu. Korzysta z opisów tekstowych, więc filtr zdjęć go nie blokuje.

### 3. `src/routes/_auth/projects.$id.index.tsx` — sekwencja w `generateAll`

Dla każdego produktu (CONCURRENCY=5):
1. `verifySourcesFn({ productId })` — try/catch, błąd weryfikacji NIE blokuje generacji.
2. `genFn({ productId, mode: "all" })`.

Pasek postępu: „Weryfikacja i generacja {done}/{total}".

### 4. Migracja DB

Dodać kolumnę `enrichments.image_meta JSONB NOT NULL DEFAULT '{}'::jsonb`. Bez zmian RLS.

## Co zostaje bez zmian

- `hidden_images`, `quality`, `golden_features` (już istnieją).
- RLS, scraping, matching.
- Widok produktu (`projects.$id.products.$pid`) — dalej ręczne `Wygeneruj cechy` i `Weryfikuj` (po-generacji).

## Detale techniczne

- Brak nowych sekretów (`LOVABLE_API_KEY` już jest).
- Limit zdjęć przekazanych do modelu wizyjnego w `verifySources`: do 8.
- Pomiar rozmiaru: lekki parser w TS (sygnatury JPEG SOF0/2, PNG IHDR, WebP VP8/VP8L/VP8X). Brak zewnętrznych zależności.
