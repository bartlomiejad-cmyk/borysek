# Zamiana modelu regeneracji na bytedance/seedream

## Cel
Zastąpić `fal-ai/bria/product-shot` modelem `fal-ai/bytedance/seedream/v4/edit` przy regeneracji zdjęcia głównego produktu. Reszta flow (upload do bucketu `regenerated-images`, zapis URL w `enrichments.regenerated_main_image`, UI, eksport) bez zmian.

## Zmiany w kodzie

**`src/lib/pim/regen.functions.ts`** — jedyny plik do zmiany:

1. Zamienić wywołanie `fal-ai/bria/product-shot` na `fal-ai/bytedance/seedream/v4/edit` z parametrami:
   - `image_urls: [data.imageUrl]` (seedream przyjmuje tablicę)
   - `prompt`: instrukcja po angielsku — "Place the product on a clean pure white seamless studio background with a soft natural shadow underneath. Keep the product centered, occupying ~70% of the frame. Professional e-commerce product photography, sharp, high detail."
   - `image_size: { width: 2560, height: 2560 }` (seedream v4 wspiera do 4096)
   - `num_images: 1`
   - `sync_mode: true`
   - `enable_safety_checker: true`
2. Wynik (`images[0].url`) idzie do istniejącego kroku konwersji WebP 2560×2560 (`fal-ai/imageutils/image-conversion`) — bez zmian.
3. Komunikaty błędów FAL (401/402/429) — bez zmian.

## Co zostaje bez zmian
- Bucket `regenerated-images` i RLS
- Kolumna `enrichments.regenerated_main_image`
- Krok konwersji do WebP 2560×2560 z fallbackiem do JPG
- UI w `projects.$id.products.$pid.tsx` (przycisk, spinner, "Cofnij")
- Logika eksportu CSV
- `FAL_KEY` (ten sam sekret)

## Koszt
Seedream v4 edit: ~$0.03 / obraz (porównywalnie do bria).
