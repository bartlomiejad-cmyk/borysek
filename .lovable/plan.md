# Plan: Uniwersalny pipeline zdjęć produktowych (A/B + galeria + styl)

## 1. Migracja DB

Osobna tabela 1:1 z `projects`:

```sql
create type public.main_image_rule as enum ('ONLY_A','A_AND_B_EXISTING','COMPOSITE_A_AND_B');

create table public.media_technical_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  component_a text not null default '',
  component_b text,
  main_image_rule public.main_image_rule not null default 'ONLY_A',
  target_resolution int not null default 2560 check (target_resolution between 512 and 4096),
  padding_percent  int not null default 70  check (padding_percent  between 30 and 95),
  max_gallery_images int not null default 5 check (max_gallery_images between 0 and 12),
  apply_shadow boolean not null default true,
  custom_style_prompt text,
  updated_at timestamptz not null default now()
);
alter table public.media_technical_settings enable row level security;
create policy "mts via project" on public.media_technical_settings
  for all using (exists (select 1 from public.projects p
    where p.id = media_technical_settings.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p
    where p.id = media_technical_settings.project_id and p.user_id = auth.uid()));
create trigger touch_mts before update on public.media_technical_settings
  for each row execute function public.touch_updated_at();

alter table public.enrichments
  add column if not exists ai_gallery_urls jsonb not null default '[]'::jsonb,
  add column if not exists media_classification jsonb not null default '{}'::jsonb;
```

`media_classification` żyje obok `image_scores` — nie nadpisuje istniejących wymiarów.

## 2. UI — sekcja "Zdjęcia AI" w Ustawieniach

W `SettingsCard` (`src/routes/_auth/projects.$id.index.tsx`) nowy blok pod istniejącymi polami:

- Input: **Komponent A** (wymagany), **Komponent B** (opcjonalny)
- Select **Reguła miniatury**: `ONLY_A` / `A_AND_B_EXISTING` / `COMPOSITE_A_AND_B`
- Number: **Rozdzielczość (px)** 512–4096
- Slider: **Wypełnienie kadru (%)** 30–95
- Number: **Limit zdjęć w galerii** 0–12
- Switch: **Sztuczny cień**
- Textarea: **Dodatkowy prompt stylistyczny** (0–500 zn.)

Save uderza w nowy `saveMediaSettings` (upsert). Load przez `getMediaSettings` z fallbackiem na defaulty.

## 3. Backend — `createServerFn`

Nowe pliki: `src/lib/pim/media.functions.ts` + `src/lib/pim/media.server.ts`.

### 3a. CRUD
- `getMediaSettings({ projectId })` — zwraca rekord lub defaulty
- `saveMediaSettings({ projectId, ... })` — upsert z walidacją Zod

### 3b. Klasyfikacja A/B
`classifyProductMedia({ productId })`:
- Pobiera A/B z settings, listę URLi z `product_sources` (+ `extra_images` zgodnie z `include_extra_images`)
- Dla każdego brakującego URL → Gemini `google/gemini-2.5-flash` (multimodal):
  ```
  Komponent A = {A}. Komponent B = {B|'BRAK'}.
  Zwróć JSON: {has_a: bool, has_b: bool, is_trash: bool}.
  is_trash = baner/infografika/tabela/sam tekst.
  Watermarki w wysokiej rozdzielczości → NIE trash (FAL je usunie).
  has_b zawsze false jeśli B = BRAK.
  ```
- Wynik merge do `enrichments.media_classification` (`{[url]: {has_a, has_b, is_trash, scored_at}}`). Concurrency 6.

### 3c. `regenerateMedia({ productId })` — główny flow
1. Settings + enrichment + wszystkie URLe scrapowane.
2. Klasyfikacja brakujących URLi (3b).
3. **Wybór głównego kandydata** wg `main_image_rule`:
   - `ONLY_A`: top z `has_a && !is_trash` (sort: rozdzielczość × `is_central` z istniejących `image_scores`).
   - `A_AND_B_EXISTING`: top z `has_a && has_b && !is_trash`; fallback `has_a`; fallback dowolne `!is_trash`.
   - `COMPOSITE_A_AND_B`: spróbuj `has_a && has_b`; jeśli brak → wybierz najlepsze A i najlepsze B osobno, przekaż **dwa URLe** do FAL.
4. **FAL — main**: `bytedance/seedream/v4/edit`:
   - `image_urls`: 1 lub 2 URLe (kompozycja)
   - `image_size`: kwadrat `target_resolution`
   - `output_format: "jpeg"`
   - prompt zbudowany przez `buildSeedreamPrompt({ padding, applyShadow, customStyle, isComposite, componentA, componentB })`
5. Upload do `regenerated-images/${enrichmentId}/main.jpg` (publiczny, z `?v=ts`).
6. **Galeria**: kandydaci `!is_trash`, sort: najpierw `has_b`, potem reszta `has_a`, bez URLa użytego do main. Limit `max_gallery_images`. Każdy → FAL pojedynczo (concurrency 2), upload do `gallery-{i}.jpg`.
7. Zapis transakcyjny: `regenerated_main_image`, `pinned_main_url`, `ai_gallery_urls`.
8. Cleanup starych plików (`${id}.{jpg,png,webp}` flat + `gallery-*` powyżej nowego N).

### 3d. Builder promptu
```
[BG]    Pure white #FFFFFF, corners exactly #FFFFFF, no cream/beige/tint...
[FRAME] Product fills {padding}% of frame, centered, equal margins.
[COMPO] (kompozycja) Place {B} naturally beside {A}, both in focus, realistic scale.
[SHADOW] (apply_shadow) Soft contact shadow only under product / (else) no shadow.
[PRESERVE] Keep every label, logo, packaging text identical to source.
[WATERMARK] Remove watermarks, shop URLs, photo credits not physically printed.
[STYLE] {custom_style_prompt}   ← wstrzykiwane dosłownie
[AVOID] cream BG, tint, vignette, tiny product, blurred text, off-center...
```

### 3e. Bulk
Klient (`regenerateAll` w `projects.$id.index.tsx`) zostaje, tylko podmiana wywołania na `regenerateMedia`. Progress bar już działa. Confirm-dialog pokazuje "X produktów × do (1 + N galerii) generacji FAL".

## 4. Eksport CSV

`src/lib/pim/export.functions.ts`:
- `ai_image_main` (już jest) zostaje
- nowe: `ai_gallery_1` ... `ai_gallery_N` (N = max długości `ai_gallery_urls` w projekcie)
- nowe: `ai_gallery_all` = `urls.join(" | ")`

## 5. UI produktu

`projects.$id.products.$pid.tsx`:
- Sekcja "Galeria AI" pod miniaturą — siatka thumbów z `ai_gallery_urls`, link do podglądu.
- Przycisk **"Reklasyfikuj zdjęcia"** (czyści `media_classification` produktu) — pomocny po zmianie A/B.
- Stary przycisk "Regeneruj" woła nowy `regenerateMedia`.

## 6. Pliki

**Nowe:** migracja, `src/lib/pim/media.functions.ts`, `src/lib/pim/media.server.ts`
**Zmienione:** `regen.functions.ts` (delegacja do nowego flow), `export.functions.ts` (kolumny galerii), `projects.$id.index.tsx` (UI settings + bulk wiring), `projects.$id.products.$pid.tsx` (galeria + reklasyfikacja), `queries.functions.ts` (dociąga `ai_gallery_urls`, `media_classification`)

## 7. Decyzje domyślne (jeśli nie powiesz inaczej)

- Istniejące projekty: `component_a = ''`, `main_image_rule = ONLY_A`. UI wymusza wypełnienie A przed regeneracją.
- Jeden przycisk regeneruje main **+** galerię w jednym kliknięciu.
- `pinned_main_url` jest nadpisywany przy każdej regeneracji (jak dziś).
- Klasyfikacja cachowana — przycisk "Reklasyfikuj" wymusza refresh.

## 8. Koszty / limity

- Gemini: ~1 call / URL × średnio 10 URLi / produkt (cache).
- FAL: do 1 + `max_gallery_images` generacji / produkt. Bulk 100 prod × 6 ≈ 600 generacji.
- Concurrency: 2 produkty równolegle × 2 FAL inflight = max 4 jednoczesne FALe.
