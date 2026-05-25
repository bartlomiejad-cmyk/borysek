## Cel
Dodać do eksportu CSV dwie kolumny **`Final_main_image`** i **`Final_images`** zwracające dokładnie te same URL-e zdjęć (i w tej samej kolejności) co widok listy produktów.

## Skąd biorą się zdjęcia na liście
W `src/lib/pim/queries.functions.ts` funkcja `pickThumbsForList(...)` buduje tablicę `images` w kolejności:
1. `pinned_main_url` (jeśli ustawione i nie ukryte),
2. zdjęcia ≥ 600 px sortowane malejąco po polu,
3. pozostałe zdjęcia sortowane malejąco po polu,
4. limit 12, bez duplikatów, bez `hidden_images`.

Wartością „głównego zdjęcia” na liście jest `images[0]` (czyli pinned, gdy istnieje, w przeciwnym razie największe niezukryte).

## Zmiany w `src/lib/pim/export.functions.ts`
1. Dociągnąć z `enrichments` pola `pinned_main_url` (`hidden_images`, `image_meta`, `picked_urls` już są).
2. Wyodrębnić helper `pickThumbsForList` do `src/lib/pim/images.ts` (lub zaimportować go z `queries.functions.ts`, jeśli prościej) — żeby eksport używał **tej samej funkcji** co lista. Preferuję przeniesienie do `images.ts` (czysty moduł), bo `queries.functions.ts` to serverFn.
3. Dla każdego produktu policzyć `listImages = pickThumbsForList(allFromSources, meta, hidden, pinned, 12)` — identycznie jak w liście (te same dane wejściowe: scrapowane URL-e z `product_sources.images` z `picked_urls`; `extra_images` nie wchodzą do listy, więc też nie tutaj).
4. Dodać do zwracanego obiektu:
   - `Final_main_image: listImages[0] ?? ""`
   - `Final_images: listImages.join(",")`

## Czego nie ruszam
- Logiki `pickImages` używanej dla kolumn `image_1..3`, `images_all`, `ai_image_main`, `ai_gallery_*` — zostają bez zmian.
- Widoku listy i UI.
- Backendu/jobów.

## Pliki
- `src/lib/pim/images.ts` — dodać/wyeksportować `pickThumbsForList`.
- `src/lib/pim/export.functions.ts` — dociągnąć `pinned_main_url`, policzyć i dodać dwie kolumny.
- (opcjonalnie) `src/lib/pim/queries.functions.ts` — używać reeksportowanego helpera, żeby nie duplikować logiki.
