## Cel
Na liście produktów w projekcie PIM dodać:
1. Filtr **„Bez zdjęć"** — pokazuje produkty, dla których nie ma żadnej finalnej miniaturki (ani z picked_urls, ani wygenerowanej AI, ani wpiętej pinned).
2. Masową akcję **„Uzupełnij zdjęcia"** działającą na zaznaczonych produktach: (a) doscrapuje brakujące źródła Firecrawlem, (b) regeneruje media wg parametrów wybranych w dialogu.

## UI — `src/routes/_auth/projects.$id.index.tsx`

- Rozszerzyć `searchSchema.filter` o `"NO_IMAGES"` + dodać `SelectItem value="NO_IMAGES"` „Bez zdjęć".
- W `filtered` dodać warunek: `filter === "NO_IMAGES" && (p.thumbnail || p.regenerated_main_image || (p.ai_gallery_urls?.length ?? 0) > 0)` → odrzuć. Zostają produkty bez jakiegokolwiek zdjęcia finalnego.
- W pasku akcji po zaznaczeniu (obok „Wygeneruj golden" / „Regeneruj media") dodać przycisk **„Uzupełnij zdjęcia (N)"** otwierający nowy `FillMissingImagesDialog`.

## Nowy komponent — `src/components/pim/FillMissingImagesDialog.tsx`

Pola:
- Checkbox **Doscrapuj brakujące źródła** (domyślnie zaznaczone jeśli którykolwiek z zaznaczonych produktów ma pusty `picked_urls`).
- Checkbox **Regeneruj media** (domyślnie zaznaczone).
- Liczba **miniatur** (1–3, default 1).
- Liczba **wizualizacji lifestyle** (0–8, default 5).
- **Jakość**: `2K` / `4K` (radio, default 2K).
- Podsumowanie: „X produktów bez źródeł, Y bez wygenerowanych mediów".
- Przycisk „Uruchom".

Sekwencja po kliknięciu:
1. Jeśli wybrano scrape i są produkty bez picked_urls → `startFirecrawlDiscovery({ projectId, productIds, onlyMissing: true })`.
2. Jeśli wybrano regenerację → `createBulkJob({ projectId, kind: "REGENERATE_MEDIA", items: selectedIds, payload: { thumbs, visualizations, quality } })`.
3. Invalidate query keys `["project", id, "bulk-job", ...]`, toast, zamknąć dialog.

## Backend

### `src/lib/pim/firecrawl.functions.ts`
- W `startFirecrawlDiscovery` dodać opcjonalne pole `productIds: z.array(z.string().uuid()).optional()`. Gdy podane — użyj ich jako `targetIds` zamiast pobierać wszystkie `source_products`; `onlyMissing` filtruje dalej po `search_results.term`.

### `src/lib/pim/bulk-jobs.functions.ts`
Bez zmian schemy — `payload` już jest wspierany (`z.record(z.string(), z.unknown()).optional()`) i zapisywany w `bulk_jobs.payload`.

### `src/lib/pim/_workers.server.ts`
Worker `REGENERATE_MEDIA`:
- Przy pobieraniu joba czytać `payload` (jsonb) i mapować:
  - `thumbs` (default 1), `visualizations` (default 5), `quality` (default `"2K"`).
- Przekazywać te wartości do istniejącego kodu generującego (obecnie hard-coded 1 + 5 + 2K) — dodać parametry do wewnętrznej funkcji generującej.
- Log każdego produktu zaktualizować, żeby pokazywał wybrane liczby.

## Bez zmian
- Nie ruszamy schematu DB (kolumna `payload jsonb` w `bulk_jobs` już istnieje — potwierdzone przez istniejące `payload` w `createBulkJob`).
- Nie zmieniamy definicji „braku źródeł" na poziomie `product_sources`; używamy pustego `picked_urls` w enrichment jako proxy (spójne z resztą pipeline'u).
- Nie zmieniamy promptów FAL/Gemini.

## Weryfikacja
1. Filtr „Bez zdjęć" pokazuje tylko produkty bez thumbnail/pinned/regenerated/ai_gallery.
2. Zaznaczenie kilku produktów + dialog → widać liczniki „X bez źródeł, Y bez mediów".
3. Uruchomienie tworzy odpowiednio 1 lub 2 bulk joby, pasek progresu FIRECRAWL_DISCOVERY / REGENERATE_MEDIA rusza.
4. Worker REGENERATE_MEDIA respektuje `payload.visualizations` i `payload.quality` (widać w logu „→ 1 miniaturka + N wizualizacji, nano-banana-pro, 2K/4K").
