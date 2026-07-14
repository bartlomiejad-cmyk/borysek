# Dokumentacja projektu PIM (Lovable)

> Dokument roboczy do przekazania do Claude jako kontekst do dalszej optymalizacji procesu.
> Stan na: 2026-07-14. Język: PL.

---

## 1. Przegląd projektu

**Cel:** Narzędzie PIM (Product Information Management) dla agencji / hurtowni, które:

1. **Importuje** listę produktów klienta (CSV lub linki do stron produktowych).
2. **Wyszukuje źródła** w internecie (Firecrawl search + scrape) dla każdego produktu.
3. **Dopasowuje** źródła do produktów (EAN / nazwa / hybrid) i wybiera TOP 5 najlepszych.
4. **Generuje „złote rekordy"** — czysty opis HTML, cechy, tytuł/description SEO (również wariant Allegro).
5. **Generuje wizualizacje AI** (FAL) oraz **regeneruje miniaturę** produktu na czystym białym tle.
6. **Udostępnia klientowi** listę + karty produktów pod linkiem z hasłem, z komentarzami zwrotnymi.
7. **Eksportuje** do CSV gotowego do wgrania do sklepu / Allegro.

**Typowy workflow:**

```text
CSV/URL import
   ↓
Firecrawl discovery (bulk job)
   ↓
runMatching (scoring + TOP 5 cap)
   ↓
Generuj złote rekordy (SEO + opis HTML)
   ↓
Regen miniatury + Wizualizacje AI (FAL, bulk job)
   ↓
Share link do klienta → feedback
   ↓
Eksport CSV
```

---

## 2. Stack technologiczny

| Warstwa | Technologia | Uwagi |
|---|---|---|
| Framework | TanStack Start v1 + React 19 | File-based routing w `src/routes/` |
| Bundler | Vite 7 | Plugin TanStack (code-splitter, server-fn transformer) |
| Runtime serwera | Cloudflare Workers (workerd + `nodejs_compat`) | Timeout 30 s, brak natywnych binarek |
| Styling | Tailwind v4 | Tokens w `src/styles.css` |
| DB / Auth / Storage | Supabase („Lovable Cloud") | RLS wszędzie, role przez `user_roles` + `has_role()` |
| AI (tekst) | Lovable AI Gateway | Gemini 2.5 Flash / Flash Lite, GPT-4o (sugestie/wizja) |
| AI (obraz) | FAL AI | Edit, Bria background remove |
| Web scraping | Firecrawl v2 | Search, scrape, stealth (residential proxies) |

**Runtime env** (dostęp tylko wewnątrz `.handler()`):
`LOVABLE_API_KEY`, `FIRECRAWL_API_KEY`, `FAL_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SHARE_SIGNING_SECRET`, `PUBLIC_APP_URL`.

---

## 3. Architektura kodu

### 3.1. Struktura folderów

```text
src/
├── routes/                        # file-based routing
│   ├── __root.tsx                 # shell (head/meta)
│   ├── _auth.tsx                  # gate autoryzacji (redirect → /login)
│   ├── _auth/
│   │   ├── projects.index.tsx
│   │   ├── projects.$id.index.tsx
│   │   ├── projects.$id.products.$pid.tsx           # edytor produktu
│   │   ├── projects.$id.products.$pid_.preview.tsx  # podgląd karty klienta
│   │   ├── projects.$id.verify.tsx
│   │   ├── photo.index.tsx  /  photo.$id.tsx        # narzędzie zdjęć
│   ├── share.$token.tsx           # publiczny share (lista)
│   ├── share.$token.p.$pid.tsx    # publiczny share (karta)
│   ├── login.tsx
│   └── api/public/hooks/process-bulk-jobs.ts   # cron / worker tick
│
├── lib/pim/
│   ├── *.functions.ts             # createServerFn — wywoływane z klienta
│   ├── *.server.ts                # server-only helpery (np. crypto, image-size)
│   ├── _workers.server.ts         # implementacja workerów bulk_jobs
│   ├── parsers.ts                 # CSV parser, mapowanie kolumn
│   ├── source-cleanup.ts          # sanityzacja opisów + filtr obrazów
│   ├── seo.ts                     # prompty złotych rekordów (SEO + Allegro)
│   └── images.ts                  # helpery URL obrazów
│
├── components/pim/                # dialogi UI (Import, Wizualizacje, Share…)
├── integrations/supabase/         # AUTO-GEN (nie edytować)
└── start.ts                       # rejestracja middleware (attachSupabaseAuth)
```

### 3.2. Podział warstw serwerowych

- **`*.functions.ts`** — `createServerFn` z `@tanstack/react-start`. Typowe RPC z klienta. Handler chroniony `requireSupabaseAuth`. Handler body **nie może** referować sibling const/function ze scope modułu (splitter je wycina → runtime `ReferenceError`) — przenieść do osobnego `.server.ts` lub trzymać wewnątrz handlera.
- **`*.server.ts`** — moduły ładowane **tylko** przez importy w innych modułach serwerowych (lub dynamic import wewnątrz handlera). Bezpieczne miejsce na `node:crypto`, `supabaseAdmin`, itd.
- **`src/routes/api/public/*`** — server routes (webhooki, cron, publiczne API). W tym projekcie jeden endpoint: `process-bulk-jobs` (tick workera).

### 3.3. Autoryzacja

- Klient: `@/integrations/supabase/client` (publishable key, RLS jako zalogowany user).
- Server function: `requireSupabaseAuth` middleware → `context.supabase`, `context.userId`, `context.claims`.
- Attacher: `src/start.ts` rejestruje `functionMiddleware` który dopina bearer token do serverFn call.
- Admin (bypass RLS): `supabaseAdmin` z `client.server.ts` — **wyłącznie** w server-only modułach lub w handlerze przez `await import(...)`.

### 3.4. Bulk jobs

Ciężkie pipeline'y (scrape wielu produktów, generacja wizualizacji) przekraczają 30 s CF Workers, więc idą przez kolejkę:

```text
Klient wołuje np. startFirecrawlDiscovery
   → INSERT do bulk_jobs (kind, items[], status=PENDING)
   → fetch POST /api/public/hooks/process-bulk-jobs  (fire-and-forget)

Cron / hook: process-bulk-jobs
   → wybiera 1 PENDING job
   → status=PROCESSING, iteruje items[]
   → aktualizuje progress
   → status=DONE / FAILED
```

`bulk_job_kind` (enum PG): `FIRECRAWL_DISCOVERY`, `PIM_VISUALIZATIONS`, `PIM_REGEN`, `PIM_MATCHING`, `PIM_FILL_MISSING_IMAGES`, `PIM_ALLEGRO_DESC`, `PIM_GOLDEN`.

**Faktyczne wartości `bulk_job_kind`** (enum PG, w kolejności historycznej):
`GENERATE_GOLDEN`, `REGENERATE_MEDIA`, `FIRECRAWL_DISCOVERY`, `PHOTO_TOOL_GENERATE`, `PHOTO_TOOL_EDIT_IMAGE`, `PIM_VISUALIZATIONS`, `PIM_ALLEGRO_DESCRIPTION`, `PIM_RESCRAPE`, `PIM_IMAGE_VERIFY`, `PIM_AUDIT`. Wcześniej cytowane skróty (`PIM_REGEN`, `PIM_GOLDEN`, `PIM_ALLEGRO_DESC`, `PIM_FILL_MISSING_IMAGES`, `PIM_MATCHING`) to były robocze etykiety — w bazie nie istnieją. Regenerację miniatury obsługuje `REGENERATE_MEDIA`, złote rekordy `GENERATE_GOLDEN`, opisy Allegro `PIM_ALLEGRO_DESCRIPTION`, powtórny scrape `PIM_RESCRAPE`, walidację wizualną galerii `PIM_IMAGE_VERIFY`, audyt jakości `PIM_AUDIT`. Uzupełnianie brakujących zdjęć jest realizowane jako `PIM_RESCRAPE` + `REGENERATE_MEDIA`, a matching jest wywoływany synchronicznie (bez własnego kind).

---

## 4. Model danych (Supabase, schema `public`)

| Tabela | Rola | Kluczowe kolumny |
|---|---|---|
| `projects` | Projekt klienta | `id`, `name`, `owner_id`, `strategy` (EAN/NAZWA/HYBRID), `settings` |
| `source_products` | Wiersze z importu CSV/URL | `id`, `project_id`, `ext_id`, `nazwa`, `kod`, `ean`, `raw` (JSONB — tu żyją `producent`, `kod_producenta`/MPN, cena, zaimportowane URL-e obrazów i cokolwiek innego dostarczonego przez CSV/JSON-LD), `product_notes`, `pipeline_status` (enum `pim_pipeline_status`: `IMPORTED` → `SOURCES_FOUND` → `MATCHED` → `GOLDEN_READY` → `VISUALS_READY`, forward-only), `review_status` (enum `pim_review_status`: `NONE`/`AI_FLAGGED`/`NEEDS_REVIEW`/`APPROVED`), `manual_lock` (bool — zamraża pipeline dla ręcznych korekt), `approved_at`, `approved_by` |
| `search_results` | Wynik Firecrawl search dla termu | `project_id`, `term`, `organic_urls[]` |
| `product_sources` | Zescrapowane strony (per URL) | `project_id`, `url`, `title`, `description`, `images[]`, `extra_images[]` |
| `imported_extract` | Surowe dane z importu z linku | `project_id`, `url`, `raw_json`, `extracted` |
| `enrichments` | Wynik matchingu + złoty rekord + widoczność galerii | `source_product_id`, `status`, `match_type`, `matched_term`, `picked_urls[]`, `golden_name`, `golden_description` (HTML), `golden_features`, `golden_slug`, `golden_meta_description`, `golden_seo_keywords`, `allegro_description`, `allegro_generated_at`, `pinned_main_url` (główny obraz produktu — **żyje na enrichments, nie na source_products**), `ai_gallery_urls[]` (obrazy wygenerowane przez FAL + wgrane z CSV z sentinelem `__imported__`), `hidden_images[]`, `image_scores` (JSON per URL: `identity`/`is_banner_or_trash`/`manual_keep`/`dead`/`identity_v`/`w`,`h`/`large_url`/`dedup_of`), `regenerated_main_image`, `audit` (JSON: wynik `runAuditForProduct`) |
| `bulk_jobs` | Kolejka | `kind`, `status`, `items[]`, `progress`, `error`, `result` |
| `project_shares` | Link udostępniania | `token_hash`, `password_hash` (PBKDF2 100k), `salt`, `expires_at`, `approved_only` (bool — udostępnia tylko produkty z `review_status=APPROVED`) |
| `client_feedback` | Komentarze klienta | `share_id`, `product_id` (nullable = global), `body`, `flag` |
| `user_roles` | Role użytkowników | `user_id`, `role` (enum `app_role`); dostęp przez `has_role(uid, role)` SECURITY DEFINER |

**RLS:** każda tabela ma polityki — właściciel projektu widzi swoje dane; publiczne trasy `share.*` korzystają z serwerowej weryfikacji tokenu (nie RLS).

**Statusy per produkt — dwie osie:**

- `pipeline_status` (postęp automatyczny): każdy worker w `_workers.server.ts` woła `advancePipelineStatus()` — forward-only. Ranga: `IMPORTED=0` → `SOURCES_FOUND=1` → `MATCHED=2` → `GOLDEN_READY=3` → `VISUALS_READY=4`. Regeneracja **nie cofa** rangi.
- `review_status` (kontrola człowieka): `NONE` → (audyt AI) `AI_FLAGGED`/`NEEDS_REVIEW` → (klient/operator) `APPROVED`. Regeneracja złotego rekordu lub opisu Allegro produktu w stanie `APPROVED` demotuje go do `NEEDS_REVIEW` z logiem `[review-reset]`. Feedback klienta `kind=needs_fix` również demotuje `APPROVED`/`NONE` → `NEEDS_REVIEW`. Ręczne edycje pól **nie** unieważniają zatwierdzenia.
- `manual_lock=true` chroni pinned/ręczne dane przy powtórnych discovery/matching/regen.

---

## 5. Kluczowe procesy (pipeline)

### 5.1. Import produktów

**5.1.1. CSV**
- UI: `components/pim/ImportCsvDialog.tsx` (sticky header/footer, przewijalna preview).
- Parser: `lib/pim/parsers.ts` — heurystyczne mapowanie kolumn (nazwa, ean, cena, obrazy, producent, mpn), auto-detekcja separatora.
- Ingest: `lib/pim/ingest.functions.ts` — INSERT do `source_products`.
- **Obrazy z CSV** → `enrichments.pinned_main_url` (główne) + reszta trafia do `enrichments.ai_gallery_urls` z sentinelem `__imported__`, który odróżnia je od realnych wizualizacji AI. Producent, MPN, EAN i pozostałe kolumny CSV lądują w `source_products.raw` (JSONB) — schemat tabeli trzyma tylko `nazwa/kod/ean/ext_id`.
- **Znany problem:** wiodące zera w EAN (Excel sformatuje `625` jako `000000000625`). TODO: auto-strip przy imporcie lub przycisk masowego czyszczenia.

**5.1.2. Import z linków**
- UI: `components/pim/ImportUrlsDialog.tsx` (checkbox „Tryb stealth" — używa Firecrawl residential proxies).
- Logic: `lib/pim/import-urls.functions.ts`:
  - Firecrawl scrape (formats: markdown + html + json-ld).
  - Ekstrakcja nazwy: kolejno JSON-LD `Product.name` → `og:title` → `<h1.product-name>` → `<h1>` → `<title>`.
  - Ekstrakcja marki (`brand`), MPN (`sku`/`mpn`), EAN (`gtin*`).
  - **Detekcja blokad:** reCAPTCHA / Cloudflare challenge / lista fraz zabronionych w nazwie → produkt odrzucany zamiast zapisania „reCAPTCHA".
  - Wynik → `imported_extract` (surowy JSON-LD + markdown do dalszej analizy) + `source_products` z zaimportowanymi wartościami producenta/MPN/URL-i schowanymi w `raw` jsonb.

### 5.2. Discovery źródeł (Firecrawl)

- Wejście: `lib/pim/firecrawl.functions.ts` → `startFirecrawlDiscovery`.
- Bulk job `FIRECRAWL_DISCOVERY` (worker w `_workers.server.ts`).
- Dla każdego produktu: search Firecrawl (query = ean/nazwa/hybrid) → filtr `MARKETPLACE_DOMAINS` (Allegro, Amazon, eBay, Ceneo, forum, wikipedia…) + per-project blacklist → scrape TOP N.
- Sanityzacja HTML:
  - `extractProductRegionHtml` — izolacja regionu produktu (containers z `itemtype=Product`, `#product`, `.product-page`, itd.).
  - `stripRelatedProductBlocks` — wycięcie sekcji „Powiązane / polecane / klienci kupili również".
- **Ekstrakcja dużych obrazów** (`upgradeToLargeImageUrl`):
  - WooCommerce: `-150x150.jpg` → oryginał, atrybut `data-large_image`.
  - Shopify: `_100x100.jpg` / `_small.jpg` → `_1024x.jpg` / `_2048x.jpg`.
  - Magento: `/cache/…/` → oryginał.
  - IdoSell: `/large/` z `/small/`.
  - Speed-line i podobne: `/ai/140/` → `/ai/2000/`.
  - Lazy: `data-src`, `data-original`, `data-splide-lazy`, `srcset` → największy wariant.
- **Filtr wizualny (Gemini Vision):** dla każdego obrazu prompt „Czy to zdjęcie produktu, czy baner/logo/kontakt?" → wynik w `enrichments.image_scores[url].is_banner_or_trash`. `recleanProductSources` używa tego jako czarnej listy bez ponownego scrape'u.
- **Identity check + rozmiar obrazu:** `image-probe.server.ts` sonduje HEAD/GET dla URL-i bez zapisanych wymiarów (`w`/`h`) — probe leci **tylko dla URL-i bez cache**. `image-variants.ts` (`baseVariantKey`, `upgradeToLargeImageUrl`) grupuje warianty tego samego zdjęcia (mniejsza vs większa rozdzielczość Shopify/Woo/Magento) — w `getVisibleGallery` z klastra zostaje **największy** wariant (`dedup_of` wskazuje pochłonięty URL). Główny obraz preferowany, gdy `min(w,h) >= 800 px`; poniżej UI pokazuje badge „niska rozdzielczość". Weryfikację identyczności (Gemini Vision) prowadzi bulk job `PIM_IMAGE_VERIFY`, wersjonowany polem `identity_v` — bump wersji (obecnie `identity_v=3`, gdzie EAN-referenced anchor jest twardym dowodem tożsamości) wymusza rewalidację cache'u.

### 5.3. Matching (`runMatching`)

Plik: `lib/pim/matching.functions.ts`.

**Strategie** (per projekt `projects.strategy`):
- `EAN` — lookup po EAN.
- `NAZWA` — lookup po nazwie.
- `HYBRID` — `"nazwa ean"` → EAN → nazwa (fallbacki).

**Kroki po dopasowaniu:**
1. **Zawsze** pobiera metadane `product_sources` dla wszystkich `picked_urls` (chunkowane po 200).
2. **Sanityzacja** (persist do DB): `sanitizeProductDescription` + `filterImageUrls`.
3. **AI-walidacja (opcjonalna):** Gemini 2.5 Flash Lite decyduje czy źródło opisuje ten sam produkt (marka + model + wariant); response `{keep: number[]}`.
4. **Scoring** (`scoreSource`, zawsze aktywny):
   - `descLen >= 200` → +3, `>= 40` → +1
   - **EAN confirmed** (`eanConfirmedFor` — sprawdza EAN produktu, także po wystripowaniu wiodących zer, w tytule/opisie/URL-u na digits-only) → **+8** (dominujący sygnał zaufania; źródła z potwierdzonym EAN wygrywają scoring, dostarczają anchor-reference dla identity check w `PIM_IMAGE_VERIFY`, a rozjazdy opakowań względem tego anchoru są odrzucane).
   - Tokeny z nazwy (≥3 znaki) w tytule → +2
   - `min(imagesCount, 3)`
   - Domena zawiera nazwę producenta (normalizowana) → +5 (`producer_boost`)
   - Domena w `settings.trusted_domains` → dodatkowy boost (`trusted_boost`)
   - Śmieciowe źródło (brak tytułu + <40 znaków opisu + 0 obrazów) → −5
5. **Cap TOP 5** — sortowanie po score desc, obcięcie.
6. **Cluster dedup** — warianty tego samego produktu z jednej domeny (identyczna karta w różnych rozmiarach) są grupowane po `variant_key` i redukowane do najlepszej instancji przed capem.

**Output:** `enrichments` upsert (`status`, `match_type`, `matched_term`, `picked_urls`).

### 5.4. Sanityzacja opisów (`source-cleanup.ts`)

**`sanitizeProductDescription`** — obcina i filtruje:
- `DESC_HEADING_RE` — nagłówki które ucinają dalszą treść (np. „Opis i specyfikacja", „Dostawa", „Zwroty", „Opinie użytkowników", „Kup na raty").
- `DESC_CUT_HEADINGS` — twarde cięcia sekcji.
- Regex-based blocklist: „Rozmiar:", „Nasza cena", „Paczkomat", „Producent:", „Wszystkie produkty tego producenta", „Przebijemy ofertę", numery telefonów, stopki, dane kontaktowe.

**`filterImageUrls`** — usuwa logo, ikony kontaktu, płatności (Blik/Bazant), banery, breadcrumby, favicony, transparent 1x1.

**Tłumaczenie / kompresja AI** — długie opisy techniczne są streszczane przez AI do formy sprzedażowej (przy generacji złotego rekordu).

### 5.5. Generacja złotych rekordów / SEO

Plik: `lib/pim/seo.ts` + workflow w `_workers.server.ts` (`PIM_GOLDEN`).

- `GOLDEN_SEO_SYSTEM_PROMPT`:
  - Wyjście: JSON `{title, meta_description, description_html, features[]}`.
  - Opis HTML **musi** zaczynać się od `<h3>Nazwa produktu</h3>`, dalej akapity `<p>`, cechy jako `<ul><li>`.
  - Brak inline stylów, brak marketingu bez pokrycia w danych.
- `sanitizeGoldenDescriptionHtml` — post-processing: usuwa `<script>`, wymusza whitelist tagów.
- **Wariant Allegro** (`ALLEGRO_DESCRIPTION_SYSTEM_PROMPT`, bulk job `PIM_ALLEGRO_DESC`):
  - Bloki „zdjęcie | tekst" (Allegro description v2).
  - Sekcja „W zestawie znajdziesz:".
  - Rozbudowane wypunktowania cech i zastosowań.
  - Ton sprzedażowy, bez cen i danych kontaktowych (zabronione przez politykę Allegro).
- Zawsze dostępny również „Generuj z 3 źródeł" z UI edytora produktu — używa tego samego promptu ale ograniczonych źródeł.

### 5.6. Regeneracja miniatury

Plik: `lib/pim/regen.functions.ts` + worker.

1. FAL edit z obrazem produktu i promptem:
   - **Zakazane:** zmiana koloru, logo, tekstu, proporcji, tekstur.
   - **Wymuszone:** czyste białe tło `#FFFFFF (255,255,255)`, brak cieni sztucznych.
2. `flattenToWhiteBackground` — merge PNG na biały canvas (bez natywnych binarek — pure JS/WASM).
3. FAL Bria `background/remove` → cutout → ponowne wklejenie na `#FFFFFF`, aby zlikwidować beżowe/szare tła generowane przez model.
4. **Fallback 422:** jeśli edycja z referencjami zwróci 422, retry bez obrazów referencyjnych z uproszczonym promptem.

### 5.7. Wizualizacje AI

- UI: `components/pim/GenerateVisualizationsDialog.tsx` (pola „Styl/scena" + „Wymagania").
- **Sugestie AI** (`lib/pim/ai.functions.ts` → `suggestVisualizationField`) — GPT-4o pisze styl i wymagania na podstawie nazwy + danych produktu.
- **Analiza zdjęć** (Gemini Vision) — na życzenie ogląda zdjęcia źródłowe i personalizuje prompt.
- Bulk job `PIM_VISUALIZATIONS`:
  - Async kolejka FAL API (submit → poll status → fetch result).
  - Wynik zapisywany do `enrichments.ai_gallery_urls`.
  - Widoczność: sekcja „Wizualizacje AI" w edytorze + badge z licznikiem na liście.

### 5.11. Filtr galerii — jedno źródło prawdy (`lib/pim/gallery.ts`)

`getVisibleGallery(urls, enrichment)` zwraca trójkę `{ accepted, unsure, rejected }` używaną **wszędzie**: lista produktów, edytor, karta preview, publiczny share, eksport CSV. Dzięki temu odrzucone/niepewne zdjęcia nigdy nie wyciekają do klienta. Reguły w kolejności:

1. `hidden_images` → wykluczone ze wszystkich kubełków.
2. `image_scores[url].manual_keep === true` → akceptowane (nadpisuje werdykty AI).
3. `is_banner_or_trash === true` → wykluczone (baner/logo/kontakt).
4. `dead === true` → wykluczone (URL nieosiągalny).
5. `identity === 'same'` → akceptowane; `'unsure'` → do przeglądu; `'different'` → odrzucone. Brak werdyktu → akceptowane domyślnie.

Klastry wariantów (`image-variants`) są zredukowane do największego przed zwróceniem. `pinned_main_url` — jeśli przeżyje reguły — zawsze pierwszy w `accepted`. `SharePublicProduct` renderuje **wyłącznie** wynik `getVisibleGallery` i nigdy nie ujawnia surowych `image_scores`/audytu.

### 5.12. Audyt jakości (`PIM_AUDIT`)

- `lib/pim/audit.ts` + serverFn `runAuditForProduct` + bulk job `PIM_AUDIT`.
- Miks checków deterministycznych (kompletność pól złotego rekordu, długość opisu, EAN checksum, obecność cech, białe tło miniatury, min. rozdzielczość głównego obrazu) i LLM (Gemini Flash — spójność opisu z cechami/nazwą).
- Zapis do `enrichments.audit` (JSON: `verdict`, `checks[]`, `notes`). Audyt **nie modyfikuje** złotego rekordu, obrazów, źródeł ani `pipeline_status` — tylko `enrichments.audit` oraz przejście `review_status` (`pass` → `NONE`, `warn` → `NEEDS_REVIEW`, `fail` → `AI_FLAGGED`). `APPROVED` **nigdy** nie jest tknięte przez audyt.
- UI: przycisk „Uruchom audyt" w edytorze produktu + badge werdyktu na liście + akcja masowa z nagłówka projektu.

### 5.13. Zatwierdzanie produktów (`review_status`)

- `lib/pim/review.functions.ts`: `approveProduct`, `unapproveProduct`, `bulkApprovePass(projectId, productIds?)` (zatwierdza tylko produkty z audytem `verdict='pass'`, pomija już zatwierdzone).
- UI: badge „Zatwierdzony" + akcje „Zatwierdź"/„Cofnij" w wierszu i w nagłówku edytora, pasek „Zatwierdź wszystkie z wynikiem Pass" przy filtrze **Do przeglądu**, checkbox „Udostępnij tylko zatwierdzone produkty" w `ShareProjectDialog`, wariant „Eksportuj tylko zatwierdzone" w menu Eksport.
- Zatwierdzenie **nigdy** nie ustawia `manual_lock`. Automatyczne zatwierdzanie jest zabronione — jedyne wejścia to ręczna akcja operatora oraz `bulkApprovePass`.

### 5.14. Redesign nagłówka projektu (Pipeline Stages)

- `components/pim/PipelineStages.tsx` — 6-stopniowy pasek postępu (**Import → Źródła → Dopasowanie → Treści → Media → Review**) zamiast płaskiego rzędu przycisków.
- Karty stopni pokazują `done/total` kumulatywnie: etap `k` „done", gdy `pipelineStatusRank(pipeline_status) >= k`; Review „done", gdy `review_status = APPROVED`. Kolumna „Status" na liście produktów została usunięta.
- Pod paskiem strip „następny krok" z linkiem „pokaż te produkty" ustawiającym filtr listy (nie klikamy w same karty — filtr jest niezależny).
- Filtr listy w polskich etykietach zorientowanych na pending: „Do dopasowania", „Do treści", „Do mediów", „Do przeglądu", „Wszystkie", plus stan pusty „Brak produktów na tym etapie — wszystko zrobione" z przyciskiem „Pokaż wszystkie".
- Akcje operacyjne przeniesione do dropdownów **Narzędzia** (Guidelines, Reclean, Remap CSV, Uzupełnij dane z CSV, Audyt AI, weryfikacja obrazów, itp.) oraz **Eksport** (CSV/XLSX, warianty „tylko zatwierdzone"). Karty importu są zwinięte do stopnia 1 (Import).

### 5.8. Podgląd karty produktu (dla klienta live)

- Trasa: `_auth/projects.$id.products.$pid_.preview.tsx`.
- Szablon e-commerce (galeria, tytuł, opis HTML, cechy, cena — jeśli obecna).
- Sidebar/topbar aplikacji ukryty (warunek w `_auth.tsx`).
- Brak bannera demo.

### 5.9. Udostępnianie klientowi

- Trasy publiczne: `/share/$token` (lista) + `/share/$token/p/$pid` (karta).
- `lib/pim/shares.functions.ts` — utwórz link, weryfikuj hasło, listuj produkty, zapisuj feedback.
- `lib/pim/shares-crypto.server.ts` — `pbkdf2Sync(password, salt, 100_000, 32, 'sha256')`. **Uwaga:** Cloudflare Workers limit ≤ 100 000 iteracji.
- Token = HMAC-SHA256(secret, share_id). Weryfikacja w server function (nie polega na RLS).
- Klient loguje się hasłem → session cookie → dostęp do listy i kart. Komentarze `client_feedback` anonimowo, z opcjonalnym „flag do poprawy".

### 5.10. Eksport

Plik: `lib/pim/export.functions.ts`. CSV ze złotymi rekordami (kolumny konfigurowalne per projekt).

---

## 6. Prompt engineering — dobre praktyki (wdrożone)

### 6.1. Generacja/edycja obrazów
- **Nie generuj logo od zera** — pracuj w trybie **edit** na dostarczonym obrazie, lub nakładaj logo osobno warstwą.
- **Cytuj etykiety dosłownie w cudzysłowach:** `preserve label "NAZWA" letter-for-letter`.
- **Blokada zmian:** `change only background, keep product, logo, text, colors and proportions EXACTLY the same, preserve style/lighting/textures`.
- **Jakość wejścia = jakość wyjścia** — ostre logo, dobre światło, kąt ~45°, czyste tło źródłowe.
- **Referencje** — do 8–14 obrazów dla spójności serii.
- **Język fotograficzny** — kąt kamery, głębia ostrości, kierunek i temperatura światła (K), obiektyw.
- **Rozdzielczość** — 4K do e-commerce, 2K do social.
- **Weryfikuj i regeneruj** — tekst zmienia się z renderu na render; miniaturki produktowe zawsze przez pipeline `regen` + Bria (białe tło).

### 6.2. Prompty tekstowe (SEO / Allegro)
- Wyjście zawsze jako **JSON** z `response_format: json_object`.
- System prompt określa dokładny schemat, tag whitelist HTML, obowiązek `<h3>` z nazwą.
- Model matchingu: `google/gemini-2.5-flash-lite` (tanio, szybko, wystarczająco).
- Sugestie i analiza wizji: GPT-4o / Gemini 2.5 Vision.

---

## 7. Ograniczenia runtime i częste pułapki

### 7.1. Cloudflare Workers (workerd + nodejs_compat)
- **Timeout 30 s** — cokolwiek dłuższego musi iść przez `bulk_jobs`.
- **PBKDF2 ≤ 100 000 iteracji** (naruszenie → runtime error).
- **Brak:** `child_process`, `sharp`, `canvas`, `puppeteer`, `fs.watch`, `os.cpus()`. Sygnał: `[unenv] X is not implemented yet!`.
- **OK:** `fs` (virtual), `path`, `crypto`, `Buffer`, `stream`, `zlib`, fetch, timers.
- **Bundling:** wszystko musi być embed-at-build-time. `ssr.external` w vite.config **złamie build**.

### 7.2. TanStack Start
- `process.env.X` czytać **wewnątrz `.handler()`**, nie na module scope.
- W `*.functions.ts` **handler body nie może** odwoływać się do sibling const/function z module scope tego samego pliku — splitter je wycina. Symptom: kod przechodzi TS, wywala się `ReferenceError` w runtime. Rozwiązanie: import z osobnego pliku lub definicja wewnątrz handlera.
- `requireSupabaseAuth` server function **nie wolno** wołać z loadera publicznej trasy — SSR/prerender leci 401 i `build:dev` failuje. Wołać z komponentu (`useServerFn` + `useQuery`) albo z loadera pod `_authenticated/`.
- `attachSupabaseAuth` w `src/start.ts` **musi** być zarejestrowane jako `functionMiddleware`, inaczej „Unauthorized: No authorization header provided".
- `src/server/` jest zablokowany dla klienta — używać sufixu `.server.ts` dla server-only helperów. `supabaseAdmin` ładować `await import('@/integrations/supabase/client.server')` wewnątrz handlera.

### 7.3. Firecrawl
- Response shape: SDK Node zwraca pola bezpośrednio na obiekcie (`result.markdown`), REST bywa wrapped (`result.data.markdown`) — normalizator w warstwie proxy.
- 402 (insufficient credits) — komunikat użytkownikowi (managed connection → coupon `LOVABLE50`).
- Antybot: `stealth: true` + residential proxies dla zablokowanych domen; detekcja reCAPTCHA/Cloudflare przed zapisem produktu.

### 7.4. FAL AI
- 422 „Could not generate images with the given prompts and images" → fallback bez obrazów referencyjnych + uproszczony prompt.
- Async job dla wizualizacji — synchronous timeout w Workers zabiłby request.

---

## 8. Backlog / do przemyślenia z Claude

**Pipeline dokładności:**
- [ ] Skuteczność scoringu + TOP 5 na dużych projektach (>10k SKU) — walidacja czy filtr nie odrzuca zbyt agresywnie.
- [ ] Sanityzacja opisów — obecnie regex-based, dużo false positives na nowych sklepach. Rozważyć **LLM cleaner** jako fallback (Gemini Flash Lite: „usuń wszystko co nie jest opisem tego konkretnego produktu, zachowaj HTML strukturę").
- [ ] Auto-detekcja platformy sklepu (WooCommerce / Shopify / Magento / IdoSell / custom) na podstawie meta-tagów + dobór ekstraktora zamiast globalnych regexów.
- [ ] Ekstrakcja dużych obrazów — obecnie ręczne dodawanie regex per platforma. Rozważyć heurystykę „największy rozmiar w srcset / og:image / JSON-LD".
- [ ] Filtr wizualny Gemini — koszt/latency przy dużych projektach; batchować + cache per URL.

**Import:**
- [ ] Wiodące zera w EAN (CSV/Excel) — auto-strip przy imporcie z ostrzeżeniem, czy przycisk masowego czyszczenia.
- [ ] Walidacja EAN checksum przy imporcie (odrzucanie nieprawidłowych).
- [ ] Import z linku — batch/kolejka dla >10 URL naraz (obecnie sync w handlerze, ryzyko timeout).

**Wizualizacje:**
- [ ] Retry policy dla FAL 422 — obecnie jeden fallback; dodać N prób z eskalacją promptu.
- [ ] Rate limiting Firecrawl + FAL — kolejkowanie żeby nie palić kredytów na duplikatach.

**Klient / share:**
- [ ] Powiadomienia email o nowym feedbacku klienta (`client_feedback` insert → mail).
- [ ] Wersjonowanie złotych rekordów — history + rollback po komentarzu klienta.

**Operacyjnie:**
- [ ] Testy end-to-end pipeline'u (playwright) — jeden fixture-project, uruchamiane po każdej większej zmianie w `_workers.server.ts`.
- [ ] Dashboard „zdrowia" bulk_jobs — ile FAILED, gdzie zawiesza się worker.
- [ ] Observability: strukturalne logi (`console.log` z tagami `[matching]`, `[firecrawl]`, `[fal]`).

---

## 9. Mapa kluczowych plików

| Plik | Rola |
|---|---|
| `src/routes/__root.tsx` | Shell HTML, meta tagi |
| `src/routes/_auth.tsx` | Guard autoryzacji, ukrywanie sidebara na `/preview` |
| `src/routes/_auth/projects.index.tsx` | Lista projektów |
| `src/routes/_auth/projects.$id.index.tsx` | Widok projektu (lista produktów, akcje masowe) |
| `src/routes/_auth/projects.$id.products.$pid.tsx` | Edytor produktu (źródła, złoty rekord, wizualizacje) |
| `src/routes/_auth/projects.$id.products.$pid_.preview.tsx` | Podgląd karty klienta (live) |
| `src/routes/share.$token.tsx` | Publiczna lista udostępniona |
| `src/routes/share.$token.p.$pid.tsx` | Publiczna karta udostępniona |
| `src/routes/api/public/hooks/process-bulk-jobs.ts` | Worker tick (cron/fire) |
| `src/lib/pim/ingest.functions.ts` | Import CSV → `source_products` |
| `src/lib/pim/parsers.ts` | Parsowanie CSV, mapowanie kolumn |
| `src/lib/pim/import-urls.functions.ts` | Import z linków (Firecrawl + JSON-LD) |
| `src/lib/pim/firecrawl.functions.ts` | Discovery + reclean; `MARKETPLACE_DOMAINS` |
| `src/lib/pim/matching.functions.ts` | `runMatching`: scoring, AI validation, TOP 5 cap |
| `src/lib/pim/source-cleanup.ts` | `sanitizeProductDescription`, `filterImageUrls` |
| `src/lib/pim/seo.ts` | Prompty złotych rekordów + Allegro |
| `src/lib/pim/regen.functions.ts` | Regen miniatury (FAL + Bria + white bg) |
| `src/lib/pim/media.functions.ts` | Zarządzanie mediami / upload |
| `src/lib/pim/ai.functions.ts` | `suggestVisualizationField`, analiza wizyjna |
| `src/lib/pim/products.functions.ts` | CRUD produktów (delete masowe/pojedyncze) |
| `src/lib/pim/projects.functions.ts` | CRUD projektów |
| `src/lib/pim/queries.functions.ts` | Odczyty (listy z filtrami: „Bez zdjęć", statusy) |
| `src/lib/pim/enrichments.functions.ts` | Zapis/odczyt `enrichments` |
| `src/lib/pim/export.functions.ts` | Eksport CSV |
| `src/lib/pim/bulk-jobs.functions.ts` | Status/progres jobów dla UI |
| `src/lib/pim/shares.functions.ts` | Share create/verify + `client_feedback` |
| `src/lib/pim/shares-crypto.server.ts` | PBKDF2 (100k) + HMAC token |
| `src/lib/pim/_workers.server.ts` | Implementacja wszystkich workerów (Firecrawl, FAL, SEO, Allegro, regen, wizualizacje) |
| `src/lib/pim/image-size.server.ts` | Rozmiar obrazu bez sharp (probe headers/magic bytes) |
| `src/lib/pim/images.ts` | Helpery URL obrazów (upgrade, dedup) |
| `src/components/pim/ImportCsvDialog.tsx` | UI import CSV |
| `src/components/pim/ImportUrlsDialog.tsx` | UI import z linków (+ tryb stealth) |
| `src/components/pim/RemapCsvDialog.tsx` | Remap kolumn |
| `src/components/pim/FillMissingImagesDialog.tsx` | „Uzupełnij zdjęcia" |
| `src/components/pim/GenerateVisualizationsDialog.tsx` | Wizualizacje + sugestie AI |
| `src/components/pim/ShareProjectDialog.tsx` | Utwórz link share |
| `src/components/pim/BulkJobLog.tsx` | Progres bulk jobs |
| `src/components/pim/UploadZone.tsx` | Dropzone plików |
| `src/integrations/supabase/client.ts` | Klient przeglądarki (AUTO-GEN) |
| `src/integrations/supabase/client.server.ts` | `supabaseAdmin` (AUTO-GEN) |
| `src/integrations/supabase/auth-middleware.ts` | `requireSupabaseAuth` (AUTO-GEN) |
| `src/integrations/supabase/auth-attacher.ts` | Bearer attacher do serverFn (AUTO-GEN) |
| `src/start.ts` | Rejestracja middleware |
| `src/router.tsx` | Konfiguracja routera |

---

## 10. Notatki dla dalszej pracy z Claude

Główne obszary, w których proces „często się psuje" i warto systemowo je dopracować:

1. **Ekstrakcja opisu ze źródła** — jeden regex-based sanitizer nie skaluje się. Cel: pipeline `raw HTML → izolacja regionu produktu → LLM cleaner z twardym schematem → deduplikacja z innymi źródłami`.
2. **Ekstrakcja obrazów** — heurystyka „największy z możliwych" zamiast per-platforma regex.
3. **Deduplikacja produktów** między źródłami — dziś TOP 5 może zawierać 5 wariantów tego samego produktu (np. różne rozmiary). Cel: klaster po `(brand, model, variant_key)`.
4. **Kontrola jakości** — automatyczny score dla golden record (kompletność pól, długość opisu, obecność cech, EAN checksum, obraz na białym tle) → flaga „do review" w UI.
5. **Idempotencja workerów** — powtórne uruchomienie discovery / matchingu nie powinno duplikować danych ani nadpisywać ręcznych korekt klienta (`pinned_*` fields).
