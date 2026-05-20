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
