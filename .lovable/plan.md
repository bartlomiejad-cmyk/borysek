## Cel

W narzędziu „Zdjęcia" pozwolić dodać wiele zdjęć źródłowych z dysku dla jednego produktu. Liczba wygenerowanych efektów wynika bezpośrednio z liczby wgranych zdjęć: **1 miniaturka packshot + (N-1) wizualizacji** (np. wgrane 10 → 1 + 9, wgrane 3 → 1 + 2, wgrane 1 → 1 + 0). Wszystkie wgrane zdjęcia trafiają do Nano Banana Pro jako referencje, żeby produkt na wyjściu był wierny.

## Zmiany

### 1. Storage
- Nowy publiczny bucket `photo-tool-sources` na wgrywki z dysku (private nie zadziała, bo model musi pobrać URL). Pliki wgrywane pod ścieżką `${userId}/${photoProductId}/${uuid}.<ext>`.
- RLS na `storage.objects`: INSERT/DELETE tylko dla właściciela (`auth.uid()`), SELECT publiczny (bucket publiczny).

### 2. Schema `photo_products`
- Dodaj kolumnę `source_image_urls text[] not null default '{}'`.
- Zachowaj istniejące `source_image_url` jako pierwszy element (kompatybilność ze starymi rekordami).
- Backfill: `UPDATE photo_products SET source_image_urls = ARRAY[source_image_url] WHERE array_length(source_image_urls,1) IS NULL;`

### 3. Server functions (`photo-tool.functions.ts`)
- `addPhotoProduct` — przyjmuje `source_image_urls: string[] (min 1)`, ustawia `source_image_url` = `[0]`.
- Nowa `deletePhotoSourceImage({ productId, url })` — usuwa plik ze storage i z tablicy (opcjonalnie, do usuwania pojedynczych zdjęć przed generacją).
- Upload robimy bezpośrednio z klienta przez `supabase.storage.from('photo-tool-sources').upload(...)` — nie potrzeba server fn.

### 4. Worker (`_workers.server.ts` → `runPhotoToolGenerate`)
- Zamiast pojedynczego `image_urls: [source]` przekaż **wszystkie** `source_image_urls` produktu jako `image_urls` do `fal-ai/nano-banana-pro/edit` (model wspiera wiele referencji).
- Miniaturka: 1 wywołanie, packshot na białym tle 2048×2048.
- Wizualizacje: dokładnie `max(0, source_image_urls.length - 1)`. Ignoruj `variants_per_product` z projektu, gdy produkt ma > 1 źródła; przy dokładnie 1 źródle używaj wartości z ustawień projektu (zachowany dotychczasowy tryb).
- Log w `bulk_job_events`: „N źródeł → 1 miniaturka + (N-1) wizualizacji".

### 5. UI (`src/routes/_auth/photo.$id.tsx`)
- W sekcji „Dodaj produkt" zamień pole „URL zdjęcia" na komponent uploadu wielu plików (drag & drop + input file `multiple`):
  - Miniaturki wgranych plików, przycisk „x" do usunięcia.
  - Progress uploadu per plik.
  - Walidacja typu (jpg/png/webp) i rozmiaru (≤ 20 MB/plik).
  - Wciąż dostępne pole „lub wklej URL" jako dodatkowe źródło (można mieszać upload + URL).
- Po kliknięciu „Dodaj do projektu": najpierw upload wszystkich plików do bucketu, potem `addPhotoProduct` z pełną listą URLi.
- W kaflu produktu pokaż miniaturę **każdego** wgranego źródła (galeria wierszowa), obok wyników.
- Sekcja „Wizualizacje na produkt" (0-4) zostaje jako fallback tylko dla produktów z 1 źródłem — dopisz notkę.

### 6. Komunikaty i licznik
- Etykieta liczby: „N zdjęć źródłowych = 1 miniaturka + (N-1) wizualizacji".
- Brak twardego limitu ilości plików (miękkie ostrzeżenie przy > 20 plikach ze względu na koszt).

## Techniczne detale (dla programisty)

- Migracja SQL: `ALTER TABLE photo_products ADD COLUMN source_image_urls text[] NOT NULL DEFAULT '{}';` + backfill + `CHECK (array_length(source_image_urls,1) >= 1)` dodać **po** backfillu.
- Bucket: `supabase--storage_create_bucket(name: 'photo-tool-sources', public: true)`, następnie migracja z policies na `storage.objects` (INSERT/DELETE `auth.uid()::text = (storage.foldername(name))[1]`, SELECT `bucket_id = 'photo-tool-sources'`).
- `prepareFalSource` w workerze wywołaj w pętli po `source_image_urls`, zbierz upload paths, przekaż jako `image_urls` do `fal-ai/nano-banana-pro/edit`; posprzątaj po wywołaniu.
- W UI: prosty `UploadZone`-podobny komponent lokalny w pliku route (albo reużyć `src/components/pim/UploadZone.tsx` po sprawdzeniu API).
