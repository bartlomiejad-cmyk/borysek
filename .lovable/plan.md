## Cel

Dodać na stronie głównej nową zakładkę „Zdjęcia" (obok obecnej listy projektów PIM), która uruchamia osobny typ projektu do generowania **miniatur (packshot 2560×2560 na białym tle)** i **wizualizacji lifestyle (2560×2560)** przez `fal-ai/nano-banana/pro`, zawsze bazując na opisie produktu i zdjęciu źródłowym, żeby wynik był zgodny z rzeczywistością.

## Założenia (do potwierdzenia w trakcie budowy jeśli się zmieni)

- **Wejście**: CSV + pojedynczy upload — CSV z kolumnami `name`, `description`, `source_image_url` (dopuszczamy też własne mapowanie kolumn, tak jak w PIM); alternatywnie drag&drop pliku + textarea z opisem dla pojedynczych sztuk.
- **Generacja per produkt**: 1× miniatura (obowiązkowa) + 1–4 warianty wizualizacji lifestyle (wybór użytkownika, domyślnie 2).
- **Model**: `fal-ai/nano-banana/pro/edit` (image-to-image) dla miniatury oraz `fal-ai/nano-banana/pro` (t2i) dla lifestyle — oba dostają prompt zbudowany z opisu produktu, żeby scena/kompozycja pasowała do rzeczywistego produktu. Rozmiar wymuszony 2560×2560.
- **Kolejkowanie**: reużywamy istniejącej infrastruktury `bulk_jobs` + `pg_cron` + `bulk_job_events` (live log jak w Firecrawl/regen).
- **Storage**: nowy public bucket `photo-tool-images` (lub reużycie `regenerated-images` w podfolderze `photo-tool/`).
- **Bez zmian** w istniejących projektach PIM — nowe narzędzie jest niezależne.

## Zmiany w bazie (migracja)

```sql
-- 1. Nowy typ projektu
create table public.photo_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Produkty w projekcie zdjęciowym
create table public.photo_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.photo_projects(id) on delete cascade,
  name text,
  description text,
  source_image_url text not null,
  status text not null default 'PENDING',            -- PENDING | PROCESSING | READY | FAILED
  thumbnail_url text,                                -- 2560×2560 packshot
  lifestyle_urls jsonb not null default '[]'::jsonb, -- lista URL-i wizualizacji
  variants_requested int not null default 2,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- GRANT + RLS: owner_id = auth.uid() (identycznie jak projects)
-- Rozszerzenie bulk_jobs.kind o 'PHOTO_TOOL_GENERATE'
```

## Backend (`src/lib/photo-tool/`)

- `photo-tool.functions.ts` — `createPhotoProject`, `listPhotoProjects`, `deletePhotoProject`, `importPhotoCsv`, `addPhotoProduct` (single upload z ręcznym opisem), `startPhotoGeneration` (tworzy `bulk_jobs` kind=`PHOTO_TOOL_GENERATE`), `getPhotoProduct`, `retryPhotoProduct`.
- `photo-tool.server.ts` (uploady do storage, budowanie promptów).
- `_workers.server.ts`: dodać `runPhotoToolGenerate(productId, ctx)` wywoływane z `processItem` w `src/routes/api/public/hooks/process-bulk-jobs.ts`. Worker:
  1. Pobiera `photo_products` + `photo_projects`.
  2. Buduje prompt z `name` + `description` (twarde reguły: „use only physical labels/logos present on the source", „no invented text", „preserve packaging").
  3. Wywołuje `fal-ai/nano-banana/pro/edit` (miniatura, biały #FFFFFF, produkt ~70% kadru — reużyjemy strukturę promptu z `regenerateMainImage`).
  4. Wywołuje `fal-ai/nano-banana/pro` (t2i) N razy dla lifestyle — prompt: „Photorealistic product photography of {name}. Scene fitting: {description-derived context}. Product must remain identical to the source reference: {source_image_url}." (przekazujemy też `image_urls` jako reference gdy model to wspiera).
  5. Uploaduje wyniki do storage, zapisuje `thumbnail_url` + `lifestyle_urls`.
  6. Emituje eventy `ctx.onEvent` (live log).

## Frontend

### Strona główna (`src/routes/_auth/projects.index.tsx` → refactor na tabs)
- Dwie zakładki: **Projekty PIM** (obecna zawartość) i **Zdjęcia** (nowa).
- Zakładka „Zdjęcia": lista `photo_projects` + przycisk „Nowy projekt zdjęciowy".

### Nowe route'y
- `src/routes/_auth/photo/index.tsx` — lista projektów zdjęciowych (alternatywnie tylko tab).
- `src/routes/_auth/photo/$id.tsx` — widok projektu:
  - Nagłówek + przyciski: „Wgraj CSV", „Dodaj pojedynczy produkt", „Generuj zaznaczone", „Zatrzymaj".
  - Tabela produktów: miniatura źródłowa, nazwa, opis (skrócony), status, przyciski „Podgląd/Regeneruj/Usuń".
  - Panel aktywnego job'a z komponentem `BulkJobLog` (reużyty).
- `src/routes/_auth/photo/$id.products.$pid.tsx` — drawer/strona produktu: źródło, miniatura, wszystkie wygenerowane wizualizacje, przycisk regeneracji per wariant, edytor opisu (wpływa na kolejną generację).

### Komponenty
- `src/components/photo/ImportPhotosDialog.tsx` — analog `ImportCsvDialog` z mapowaniem kolumn (name/description/image_url) + podgląd CSV.
- `src/components/photo/PhotoUploadDialog.tsx` — pojedynczy upload (drag&drop + opis).
- Reużycie `BulkJobLog`, `UploadZone`, `Progress`.

## Konfiguracja

- Sekret `FAL_KEY` już istnieje.
- Bucket storage — dodać w migracji (public, żeby URL-e działały w UI/eksport).

## Poza zakresem tego wdrożenia

- Eksport CSV wyników (dorobimy w kolejnej iteracji jeśli potrzebne).
- Integracja z produktami z istniejących projektów PIM (można potem dodać przycisk „Wyślij do narzędzia zdjęć").
- Automatyczna weryfikacja jakości AI (odsiew nieudanych generacji).

## Weryfikacja po wdrożeniu

1. Nowa zakładka „Zdjęcia" widoczna na `/projects`.
2. Utworzenie projektu → import CSV (5 wierszy) → job rusza, live log pokazuje kolejne produkty.
3. Miniatura na białym tle 2560×2560, lifestyle 2560×2560 z zachowanym produktem.
4. Zatrzymanie job'a działa jak w Firecrawl.
5. Regeneracja pojedynczego produktu po edycji opisu produkuje spójny wynik.
