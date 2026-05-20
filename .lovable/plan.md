# Ocena kompozycji zdjęć przez AI (gpt-4o-mini vision)

Cel: zanim weryfikator zobaczy zdjęcia produktu, AI ocenia kompozycję 4 największych zdjęć, liczymy `Score` łączący ocenę z rozdzielczością, sortujemy listę, podświetlamy najlepsze jako "Zdjęcie Główne" i pokazujemy badge'y `is_central` / `is_clean`. Fallback bez blokady: sort po pikselach.

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
- Sekret: `OPENAI_API_KEY` (`process.env`, czytany wewnątrz `.handler()`).
- Model: `gpt-4o-mini`, vision, `image_url.detail = "low"`.
- Structured Outputs (`response_format: { type: "json_schema", strict: true }`) per zdjęcie:
  ```json
  { "is_central": 1-10, "is_clean": 1-10, "is_banner_or_trash": boolean }
  ```
- System prompt: "Jesteś ekspertem e-commerce. Oceń kompozycję zdjęcia pod kątem przydatności jako główna miniaturka produktu w sklepie. Zwróć surowy JSON według podanego schematu."
- Równoległe wywołania `Promise.allSettled` (4 obrazki). Per-image timeout 15s.
- Zapis wyników do `enrichments.image_scores` (nowa kolumna JSONB, mapa `{ [url]: { is_central, is_clean, is_banner_or_trash, scored_at } }`). Cache: jeśli wynik dla URL już istnieje, nie wołamy OpenAI ponownie.
- Zwrot: `{ scores: { [url]: {...} }, source: "openai" | "cache" | "partial" }`. Błąd całościowy → throw (klient zrobi fallback).

## Krok 2 — DB migration

- `ALTER TABLE public.enrichments ADD COLUMN image_scores JSONB NOT NULL DEFAULT '{}'::jsonb;`
- Bez zmian RLS (polityka `en via project` pokrywa kolumnę).

## Krok 3 — Sekret

- Wymagany `OPENAI_API_KEY`. Jeśli brak — poproszę przez `add_secret` w trakcie implementacji.

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
