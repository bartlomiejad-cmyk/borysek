# Dokumentacja projektu PIM (Lovable)

> Dokument roboczy / kontekst do dalszej optymalizacji procesu.
> Stan na: 2026-09-02. Język: PL.

---

## 1. Przegląd projektu

**Cel:** Narzędzie PIM (Product Information Management) dla agencji / hurtowni, które:

1. **Importuje** listę produktów klienta (CSV lub linki do stron produktowych), z rozpoznaniem wariantów.
2. **Wyszukuje źródła** w internecie (Apify SERP + Firecrawl search/scrape, ze wspólnym cache) dla każdego produktu.
3. **Dopasowuje** źródła do produktów (EAN / nazwa / hybrid, tryb `strict` lub `compatible`) i wybiera TOP N.
4. **Generuje „złote rekordy"** — czysty opis HTML, cechy, kategorię, tytuł/description SEO (również wariant Allegro).
5. **Generuje wizualizacje AI** (FAL) oraz **regeneruje miniaturę** na czystym białym tle — z ochroną zdjęć klienta.
6. **Audytuje** jakość (deterministycznie + LLM) i prowadzi ścieżkę zatwierdzania przez człowieka.
7. **Udostępnia klientowi** listę + karty produktów pod linkiem z hasłem, z komentarzami zwrotnymi; osobno publiczny podgląd karty.
8. **Eksportuje** do CSV/XLSX gotowego do wgrania do sklepu / Allegro, w tym round-trip do pliku źródłowego klienta.

Poza samą aplikacją PIM w repo żyje też **landing page usługi** (`/landing`) — sprzedajemy usługę uzupełniania kart przez nasz zespół, nie self-service.

**Typowy workflow:**

```text
CSV/URL import  →  (auto) wykrycie wariantów
   ↓
Discovery: Apify SERP (+ Firecrawl fallback) → scrape (cache) → AI preselekcja
   ↓
runMatching (scoring + cluster dedup + cap)
   ↓
Generuj złote rekordy (SEO + opis HTML + kategoria)
   ↓
Regen miniatury + Wizualizacje AI (FAL, bulk job)
   ↓
Audyt AI → review → zatwierdzenie
   ↓
Share link do klienta → feedback
   ↓
Eksport CSV / XLSX / round-trip
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
| AI (tekst / wizja) | Lovable AI Gateway | Gemini 2.5 Flash / Flash Lite / Pro, Gemini 3.x, GPT-5.5 |
| AI (obraz) | FAL AI | `nano-banana-pro`, `seedream/v4/edit`, Bria/rembg background remove |
| SERP | Apify (Google Search actor) | Główne źródło wyników; tanie, równoległe |
| Web scraping | Firecrawl v2 | Scrape + fallback search, stealth (residential proxies) |
| MCP | `@lovable.dev/mcp-js` | Serwer MCP z OAuth Supabase (`src/lib/mcp/`) |

**Runtime env** (dostęp tylko wewnątrz `.handler()`):
`LOVABLE_API_KEY`, `FIRECRAWL_API_KEY`, `APIFY_TOKEN`, `FAL_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SHARE_SIGNING_SECRET`, `PUBLIC_APP_URL`.

---

## 3. Architektura kodu

### 3.1. Struktura folderów

```text
src/
├── routes/                        # file-based routing
│   ├── __root.tsx                 # shell (head/meta)
│   ├── index.tsx                  # wejście → /projects lub /login
│   ├── landing.tsx                # landing page usługi
│   ├── styleguide.tsx             # design system landinga
│   ├── _auth.tsx                  # gate autoryzacji (redirect → /login)
│   ├── _auth/
│   │   ├── projects.index.tsx
│   │   ├── projects.$id.index.tsx
│   │   ├── projects.$id.products.$pid.tsx           # edytor produktu
│   │   ├── projects.$id.verify.tsx
│   │   ├── photo.index.tsx  /  photo.$id.tsx        # narzędzie zdjęć
│   ├── projects.$id.products.$pid_.preview.tsx      # PUBLICZNY podgląd karty
│   ├── share.$token.tsx           # publiczny share (lista)
│   ├── share.$token.p.$pid.tsx    # publiczny share (karta)
│   ├── login.tsx
│   ├── mcp.ts + [.mcp]/ + [.well-known]/            # serwer MCP + OAuth discovery
│   └── api/public/hooks/process-bulk-jobs.ts        # cron / worker tick
│
├── lib/pim/
│   ├── *.functions.ts             # createServerFn — wywoływane z klienta
│   ├── *.server.ts                # server-only helpery (crypto, apify, llm-cleaner…)
│   ├── _workers.server.ts         # implementacja workerów bulk_jobs
│   ├── parsers.ts                 # CSV parser, mapowanie kolumn, hierarchia
│   ├── query-variants.ts          # buildQueryVariants + SearchQueryStrategy
│   ├── eligibility.ts             # isPipelineEligible (excluded / row_kind)
│   ├── variant-detect.ts(.test)   # wykrywanie wariantów wzorcem + AI
│   ├── source-cleanup.ts          # sanityzacja opisów + filtr obrazów
│   ├── gallery.ts                 # getVisibleGallery — jedyne źródło prawdy
│   ├── seo.ts                     # prompty złotych rekordów (SEO + Allegro)
│   └── audit.ts / review.functions.ts / roundtrip-export.functions.ts
│
├── lib/mcp/                       # definicje narzędzi MCP
├── lib/photo-tool/                # narzędzie zdjęć (osobny od PIM tor)
├── components/pim/                # dialogi UI (Import, Wizualizacje, Share…)
├── components/landing|sections|ui-custom|product/   # landing page
├── data/                          # demo-products, case-studies, stats, process-steps
├── integrations/supabase/         # AUTO-GEN (nie edytować)
└── start.ts                       # rejestracja middleware (attachSupabaseAuth)
```

### 3.2. Podział warstw serwerowych

- **`*.functions.ts`** — `createServerFn` z `@tanstack/react-start`. Typowe RPC z klienta. Handler chroniony `requireSupabaseAuth`. Handler body **nie może** referować sibling const/function ze scope modułu (splitter je wycina → runtime `ReferenceError`) — przenieść do osobnego `.server.ts` lub trzymać wewnątrz handlera.
- **`*.server.ts`** — moduły ładowane **tylko** przez importy w innych modułach serwerowych (lub dynamic import wewnątrz handlera). Bezpieczne miejsce na `node:crypto`, `supabaseAdmin`, itd.
- **`src/routes/api/public/*`** — server routes (webhooki, cron, publiczne API). W tym projekcie: `process-bulk-jobs` (tick workera).

### 3.3. Autoryzacja

- Klient: `@/integrations/supabase/client` (publishable key, RLS jako zalogowany user).
- Server function: `requireSupabaseAuth` middleware → `context.supabase`, `context.userId`, `context.claims`.
- Attacher: `src/start.ts` rejestruje `functionMiddleware` który dopina bearer token do serverFn call.
- Admin (bypass RLS): `supabaseAdmin` z `client.server.ts` — **wyłącznie** w server-only modułach lub w handlerze przez `await import(...)`, **zawsze po** weryfikacji własności zasobu przez RLS-owy klient (patrz `compat.functions.ts`, `preview.functions.ts`, MCP `run-audit`).
- MCP: OAuth z issuerem Supabase (`src/lib/mcp/index.ts`); każde narzędzie działa jako zalogowany user (`supabaseForUser`).

### 3.4. Bulk jobs

Ciężkie pipeline'y przekraczają 30 s CF Workers, więc idą przez kolejkę:

```text
Klient woła np. startFirecrawlDiscovery
   → INSERT do bulk_jobs (kind, items[], status=PENDING)
   → fetch POST /api/public/hooks/process-bulk-jobs  (fire-and-forget, worker-kick.server.ts)

Hook: process-bulk-jobs
   → claim_next_bulk_job() (advisory lock, priorytet PENDING przed wznawianiem)
   → status=PROCESSING, iteruje items[]
   → commit-after-success per item, MAX_ITEM_ATTEMPTS = 3
   → aktualizuje progress + usage (telemetria kosztów)
   → status=COMPLETED / FAILED / CANCELLED
```

**Faktyczne wartości `bulk_job_kind`** (enum PG):
`GENERATE_GOLDEN`, `REGENERATE_MEDIA`, `FIRECRAWL_DISCOVERY`, `PHOTO_TOOL_GENERATE`, `PHOTO_TOOL_EDIT_IMAGE`, `PIM_VISUALIZATIONS`, `PIM_ALLEGRO_DESCRIPTION`, `PIM_RESCRAPE`, `PIM_IMAGE_VERIFY`, `PIM_AUDIT`.
Uzupełnianie brakujących zdjęć = `PIM_RESCRAPE` + `REGENERATE_MEDIA`. Matching wywoływany synchronicznie (bez własnego kind).

**Telemetria** (`bulk_jobs.usage`, jsonb): m.in. `fal_renders`, `llm_calls`, liczniki scrape/SERP — do liczenia kosztu przebiegu.

---

## 4. Model danych (Supabase, schema `public`)

| Tabela | Rola | Kluczowe kolumny |
|---|---|---|
| `projects` | Projekt klienta | `id`, `name`, `user_id`, `strategy` (EAN/NAZWA/HYBRID), `custom_prompt`, `blacklist[]`, `visualization_style_prompt`, `visualization_requirements_pl`, `settings` (jsonb — patrz 4.1) |
| `source_products` | Wiersze z importu CSV/URL | `id`, `project_id`, `ext_id`, `nazwa`, `kod`, `ean`, `category`, `raw` (JSONB: producent, MPN, cena, URL-e obrazów…), `product_notes`, `import_row_index`, `pipeline_status`, `review_status`, `manual_lock`, `matching_mode` (`strict`/`compatible`), `compat_suggested`, `row_kind` (`main`/`variant`), `parent_sku`, `excluded`, `excluded_reason`, `excluded_at`, `approved_at`, `approved_by` |
| `search_results` | Wynik SERP dla termu | `project_id`, `term`, `organic_urls[]`, `query_variants` (jsonb) |
| `product_sources` | Zescrapowane strony (per URL) | `project_id`, `url`, `title`, `description`, `images[]`, `extra_images[]`, `image_meta`, `cleaning_meta` |
| `scrape_cache` | Cross-projektowy cache surowego scrape'u | klucz po URL; oszczędza kredyty Firecrawl |
| `imported_extract` | Surowe dane z importu z linku | `project_id`, `url`, `raw_json`, `extracted` |
| `enrichments` | Matching + złoty rekord + widoczność galerii | `source_product_id`, `status`, `match_type`, `matched_term`, `picked_urls[]`, `removed_urls[]`, `score_breakdown`, `data_sufficiency`, `rescrape_rounds`, `golden_name`, `golden_description` (HTML), `golden_features`, `golden_slug`, `golden_meta_description`, `golden_seo_keywords`, `allegro_description`, `allegro_generated_at`, `pinned_main_url`, `ai_gallery_urls[]`, `hidden_images[]`, `image_scores` (JSON per URL), `regenerated_main_image`, `audit`, `error` |
| `product_events` | Log zdarzeń per produkt (audit trail workerów, błędy FAL/LLM) | `source_product_id`, `kind`, `payload`, `created_at` |
| `bulk_jobs` | Kolejka | `kind`, `status`, `items[]`, `total`, `processed_count`, `failed_count`, `cancel_requested`, `last_error`, `usage`, `locked_at`, `lock_token` |
| `project_shares` | Link udostępniania | `token_hash`, `password_hash` (PBKDF2 100k), `salt`, `expires_at`, `approved_only` |
| `client_feedback` | Komentarze klienta | `share_id`, `product_id` (nullable = global), `body`, `flag` |
| `photo_products` | Narzędzie zdjęć | prompt, `requirements_pl`, wyniki generacji |
| `user_roles` | Role użytkowników | `user_id`, `role` (enum `app_role`); dostęp przez `has_role(uid, role)` SECURITY DEFINER |

**RLS:** każda tabela ma polityki — właściciel projektu widzi swoje dane; publiczne trasy `share.*` i `/preview` korzystają z serwerowej weryfikacji (nie RLS).

### 4.1. `projects.settings` — knoby pipeline'u (czytane call-time)

| Klucz | Znaczenie |
|---|---|
| `search_provider` | `apify` / `firecrawl` / `both` (domyślnie Apify pierwszy, Firecrawl jako fallback) |
| `search_query_strategy` | Kompozycja zapytań: 4 tryby (`buildQueryVariants`), default = status quo |
| `top_per_variant` | Ile wyników z SERP zatrzymać per wariant zapytania (domyślnie 2) |
| `serp_limit` | Ile wyników pobrać z SERP (domyślnie 10) |
| `scrape_cap` | Maks. liczba scrape'ów per produkt (domyślnie 4) |
| `trusted_domains` | Boost scoringu dla zaufanych domen |
| `client_guidelines` | Wytyczne klienta wstrzykiwane do promptów AI |
| `source_mode` | `discovery` lub `client_data` (projekty bez discovery) |
| kolumny CSV | `code_column`, `ean_column`, `name_column`, `id_column` |

### 4.2. Statusy per produkt — trzy osie

- `pipeline_status` (postęp automatyczny, forward-only): `IMPORTED=0` → `SOURCES_FOUND=1` → `MATCHED=2` → `GOLDEN_READY=3` → `VISUALS_READY=4`. Regeneracja **nie cofa** rangi.
- `review_status` (kontrola człowieka): `NONE` → (audyt AI) `AI_FLAGGED`/`NEEDS_REVIEW` → `APPROVED`. Regeneracja golden/Allegro produktu `APPROVED` demotuje do `NEEDS_REVIEW`. Feedback `needs_fix` też demotuje. Ręczne edycje pól **nie** unieważniają zatwierdzenia.
- `excluded` + `row_kind` (kwalifikacja do pipeline'u): wspólny predykat `isPipelineEligible` (`src/lib/pim/eligibility.ts`) filtruje wykluczone produkty i warianty **we wszystkich punktach wejścia** (discovery, matching, golden, media, audyt). Discovery auto-wyklucza produkty z zerową liczbą źródeł (`excluded_reason='no_sources'`); ręczne wykluczenie ma `reason='manual'` i nie jest kasowane przez re-run.

`manual_lock=true` chroni pinned/ręczne dane przy powtórnych discovery/matching/regen.

---

## 5. Kluczowe procesy (pipeline)

### 5.1. Import produktów

**5.1.1. CSV**
- UI: `components/pim/ImportCsvDialog.tsx`.
- Parser: `lib/pim/parsers.ts` — heurystyczne mapowanie kolumn (nazwa, ean, cena, obrazy, producent, mpn, kategoria, hierarchia), auto-detekcja separatora.
- Ingest: `lib/pim/ingest.functions.ts` — INSERT do `source_products` + zachowanie `import_row_index` (potrzebne do round-trip eksportu).
- **Hierarchia rodzic/wariant:** kolumny typu `parent_sku` ustawiają `row_kind='variant'`; warianty są wyłączone z pipeline'u (uzupełniane z rodzica). `reclassifyVariants` pozwala zrobić to retroaktywnie na starych projektach.
- **Auto-detekcja wariantów wzorcem (v2):** gdy plik nie ma kolumn hierarchii, po imporcie odpala się `autoDetectVariantsPhase1` (`variant-detect.ts`: `stripKodVariantSuffix` + bucket key, opcjonalnie AI grupujące). UI: `DetectVariantsDialog` (podgląd, domyślnie tworzy rodzica syntetycznego przy brakującym rodzicu, blokuje świadome osierocenie) oraz `MarkAsVariantsDialog` (ręczna furtka). Zapis atomowy przez SECURITY DEFINER RPC z advisory lockiem per projekt.
- **Obrazy z CSV = obywatel pierwszej kategorii (Tier 0 `client_owned`)** → `enrichments.pinned_main_url` + reszta do `ai_gallery_urls` z sentinelem `__imported__`. Ten sentinel **blokuje regenerację** miniatury (chroni zdjęcia klienta) — zarówno w bulk `REGENERATE_MEDIA`, jak i w pojedynczym `regenerateMainImage`.
- **Znany problem:** wiodące zera w EAN (Excel). Scoring radzi sobie porównując digits-only po strip zer, ale import nadal nie czyści.

**5.1.2. Import z linków**
- UI: `components/pim/ImportUrlsDialog.tsx` (checkbox „Tryb stealth").
- Logic: `lib/pim/import-urls.functions.ts`: Firecrawl scrape (markdown + html + json-ld), ekstrakcja nazwy (JSON-LD `Product.name` → `og:title` → `<h1>` → `<title>`), marki, MPN, EAN; detekcja blokad (reCAPTCHA / Cloudflare) → produkt odrzucany zamiast zapisania śmiecia. Wynik → `imported_extract` + `source_products`.

### 5.2. Discovery źródeł

Wejście: `lib/pim/firecrawl.functions.ts` → `startFirecrawlDiscovery`; bulk job `FIRECRAWL_DISCOVERY` (worker w `_workers.server.ts`).

**Warianty zapytań** (`query-variants.ts`, wspólne dla Apify i Firecrawl): `buildQueryVariants(product, strategy)` zwraca listę zapytań z priorytetem — m.in. goły EAN, `kind:"E"` = „EAN + nazwa", nazwa + producent, nazwa + MPN. `SearchQueryStrategy` daje 4 tryby sterowane z Ustawień; tryb „tylko EAN" jawnie pomija produkty bez EAN.

**Kolejność providerów (oszczędność kredytów):**
1. **Apify SERP** — równoległe runy per wariant, `serp_limit` (domyślnie 10), `top_per_variant` (domyślnie 2). Uwaga: numeryczne inputy actora muszą iść jako **stringi**.
2. **Firecrawl search** — fallback, gdy Apify zwróci pusto (np. dla gołego EAN).
3. **`scrape_cache`** — przed każdym scrape'em sprawdzany cross-projektowy cache surowego HTML. Trafienie w cache **musi** przywrócić także galerię źródła (regresja naprawiona).
4. **Firecrawl scrape** dla pozostałych URL-i, limit `scrape_cap`.

**Filtry i preselekcja:**
- Filtr `MARKETPLACE_DOMAINS` (Allegro, Amazon, eBay, Ceneo, fora, wikipedia…) + per-project blacklist.
- **AI preselekcja SERP** (`serp-preselect.server.ts`): model widzi do 40 kandydatów; **host-dedup jest stosowany dopiero po preselekcji**, na wybranych pickach (max 8). Prompt jest **mode-aware** — `SYSTEM_PROMPT_COMPATIBLE` dopuszcza zamienniki w trybie `compatible`, wersja strict wymaga tego samego modelu. Dokładne trafienie EAN ma najwyższy priorytet.
- Sanityzacja HTML: `extractProductRegionHtml` (izolacja regionu produktu) + `stripRelatedProductBlocks` (wycięcie „polecane/powiązane").
- **LLM cleaner** (`llm-cleaner.server.ts`): czyści opis do formy produktowej, z guardem `page_matches_product` — jeśli strona nie opisuje tego produktu, źródło jest odrzucane zamiast halucynowanego opisu.
- **Ekstrakcja dużych obrazów** (`upgradeToLargeImageUrl`): WooCommerce (`-150x150` → oryginał, `data-large_image`), Shopify (`_100x100`/`_small` → `_1024x`/`_2048x`), Magento (`/cache/…`), IdoSell (`/small/` → `/large/`), PrestaShop (`/img/p/`), lazy atrybuty (`data-src`, `data-original`, `data-splide-lazy`, `srcset`).
- **Filtr wizualny (Gemini Vision):** baner/logo/kontakt → `image_scores[url].is_banner_or_trash`.
- **Identity check + rozmiar:** `image-probe.server.ts` (HEAD/GET tylko dla URL-i bez cache `w`/`h`), `image-variants.ts` (`baseVariantKey`) grupuje warianty tego samego zdjęcia — zostaje największy (`dedup_of`). Główny obraz preferowany przy `min(w,h) >= 800 px`. Weryfikacja tożsamości = bulk job `PIM_IMAGE_VERIFY`, wersjonowany `identity_v` (obecnie 3: anchor po EAN jest twardym dowodem).

### 5.3. Matching (`runMatching`)

Plik: `lib/pim/matching.functions.ts`.

**Strategie** (`projects.strategy`): `EAN`, `NAZWA`, `HYBRID` (`"nazwa ean"` → EAN → nazwa).
**Tryby dopasowania** (`source_products.matching_mode`): `strict` (ten sam model) i `compatible` (zamienniki/kompatybilne). W trybie `compatible` kubełek Accepted galerii jest ograniczony do obrazów **najlepiej ocenionego** źródła, żeby nie mieszać fizycznie różnych produktów. `compat_suggested` sygnalizuje w UI, że warto przełączyć tryb.

**Kroki:**
1. Pobranie metadanych `product_sources` dla `picked_urls` (chunk po 200).
2. Sanityzacja (persist): `sanitizeProductDescription` + `filterImageUrls`.
3. AI-walidacja (opcjonalna, Gemini Flash Lite): `{keep: number[]}`.
4. **Scoring** (`scoreSource`): `descLen>=200` +3 / `>=40` +1; **EAN confirmed +8** (dominujący sygnał, digits-only, tolerancja wiodących zer); tokeny nazwy w tytule +2; `min(images,3)`; domena = producent +5; `trusted_domains` boost; śmieciowe źródło −5.
5. **Cluster dedup** (`applyClusterDedup`) — warianty tej samej karty redukowane do najlepszej instancji, **z zachowaniem źródeł z tego samego klastra wariantów** produktu.
6. **Cap TOP N** (sort po score desc).
7. Zapis: `enrichments` upsert + `score_breakdown`.

Ręczne usuwanie źródeł: przycisk w edytorze → `removed_urls[]` (re-run discovery ich nie przywraca).

### 5.4. Sanityzacja opisów (`source-cleanup.ts`)

- `sanitizeProductDescription` — `DESC_HEADING_RE` / `DESC_CUT_HEADINGS` ucinają sekcje („Dostawa", „Zwroty", „Opinie", „Kup na raty"), regex-blocklist na cenach, paczkomatach, danych kontaktowych, stopkach.
- `filterImageUrls` — usuwa logo, ikony płatności, banery, breadcrumby, favicony, 1x1.
- Docelowo pracę przejmuje `llm-cleaner.server.ts` (regexy jako pre-filtr).

### 5.5. Generacja złotych rekordów / SEO

Plik: `lib/pim/seo.ts` + worker `GENERATE_GOLDEN`.

- `GOLDEN_SEO_SYSTEM_PROMPT` → JSON `{title, meta_description, description_html, features[]}`; opis zaczyna się od `<h3>Nazwa produktu</h3>`, dalej `<p>` i `<ul><li>`; bez inline stylów i marketingu bez pokrycia.
- `coerceFeatures` — normalizuje `features[]` (model bywa zwraca stringi zamiast obiektów).
- `sanitizeGoldenDescriptionHtml` — whitelist tagów, usuwa `<script>`.
- **Wariant Allegro** (`ALLEGRO_DESCRIPTION_SYSTEM_PROMPT`, bulk `PIM_ALLEGRO_DESCRIPTION`): bloki „zdjęcie | tekst", sekcja „W zestawie znajdziesz:", bez cen i kontaktu.
- **Tryb `source_mode='client_data'`** — golden record generowany wyłącznie z danych klienta, z pominięciem discovery.
- Wytyczne klienta (`settings.client_guidelines`, `ClientGuidelinesDialog`) i `product_notes` są wstrzykiwane do promptów.

### 5.6. Regeneracja miniatury

Plik: `lib/pim/regen.functions.ts` + worker `REGENERATE_MEDIA`.

1. **Guard:** produkty z `regenerated_main_image === '__imported__'` (zdjęcie klienta) lub `manual_lock` są pomijane **przed** jakąkolwiek generacją FAL — w obu ścieżkach UI.
2. FAL edit: zakaz zmiany koloru/logo/tekstu/proporcji, wymuszone tło `#FFFFFF`.
3. `flattenToWhiteBackground` (pure JS/WASM) + Bria `background/remove` → cutout → ponowne wklejenie na biel.
4. **Siatka QC** (`thumbnail-qc.ts`) — przy QC-fail zachowujemy dotychczasową dobrą miniaturę zamiast nadpisywać śmieciem.
5. **Fallback 422** — retry bez obrazów referencyjnych z uproszczonym promptem.
6. `ai_gallery_urls` są **merge'owane**, nie nadpisywane — płatne wizualizacje nie giną przy regeneracji packshotów.
7. Błędy FAL są zapisywane trwale (`enrichments.error` + `product_events`) i pokazywane jako badge, a nie ulotny toast.

### 5.7. Wizualizacje AI

- UI: `components/pim/GenerateVisualizationsDialog.tsx` (pola „Styl/scena" + „Wymagania", z sugestiami AI).
- `lib/pim/ai.functions.ts` → `suggestVisualizationField` (tekst) oraz analiza zdjęć Gemini Vision (dopasowanie promptu do konkretnego produktu, z wykluczeniem martwych URL-i, żeby nie wywalać gatewaya).
- **Typy wizualizacji** (`viz_type`): packshot / lifestyle / in-use; detekcja **urządzenia-gospodarza** (`host_device`) dla akcesoriów; planowanie wielu wariantów scen (`scene-presets.ts`).
- `viz-image-guard.server.ts` — blokuje pętlę nieskończonych regeneracji przy złych obrazach wejściowych.
- Bulk `PIM_VISUALIZATIONS`: async kolejka FAL (submit → poll → fetch), wynik do `enrichments.ai_gallery_urls`.

### 5.8. Filtr galerii — jedno źródło prawdy (`lib/pim/gallery.ts`)

`getVisibleGallery(urls, enrichment)` zwraca `{ accepted, unsure, rejected }` używane **wszędzie** (lista, edytor, preview, share, eksport). Reguły w kolejności:

1. `hidden_images` / `removed_urls` → wykluczone.
2. `manual_keep === true` → akceptowane (nadpisuje AI).
3. `is_banner_or_trash === true` → wykluczone.
4. `dead === true` → wykluczone (URL nieosiągalny — liveness probe).
5. `identity === 'same'` → accepted; `'unsure'` → do przeglądu; `'different'` → rejected. Brak werdyktu → accepted.

Klastry wariantów redukowane do największego. `pinned_main_url` zawsze pierwszy w `accepted`. Publiczne widoki renderują **wyłącznie** wynik `getVisibleGallery`.

### 5.9. Audyt jakości (`PIM_AUDIT`)

- `lib/pim/audit.ts` + `runAuditForProduct` + bulk job.
- Miks checków deterministycznych (kompletność golden record, długość opisu, EAN checksum, cechy, białe tło miniatury, min. rozdzielczość) i LLM (spójność opisu z cechami/nazwą).
- Zapis do `enrichments.audit` (`verdict`, `checks[]`, `notes`). Audyt nie modyfikuje treści ani `pipeline_status`; przestawia `review_status` (`pass`→`NONE`, `warn`→`NEEDS_REVIEW`, `fail`→`AI_FLAGGED`). `APPROVED` nigdy nie jest tknięte.

### 5.10. Zatwierdzanie produktów (`review_status`)

- `lib/pim/review.functions.ts`: `approveProduct`, `unapproveProduct`, `bulkApprovePass` (tylko `verdict='pass'`).
- UI: badge + akcje w wierszu i nagłówku edytora, pasek „Zatwierdź wszystkie z wynikiem Pass", checkbox „Udostępnij tylko zatwierdzone" w share, wariant eksportu „tylko zatwierdzone".
- Automatyczne zatwierdzanie jest zabronione.

### 5.11. Nagłówek projektu (Pipeline Stages) i Ustawienia

- `components/pim/PipelineStages.tsx` — 6-stopniowy pasek (**Import → Źródła → Dopasowanie → Treści → Media → Review**) z licznikami `done/total` kumulatywnie. Akcje etapu można odpalać niezależnie od ukończenia poprzednich etapów (liczy się liczba kwalifikujących się produktów).
- Filtr listy: „Do dopasowania", „Do treści", „Do mediów", „Do przeglądu", „Wszystkie" + stan pusty.
- Dropdowny **Narzędzia** (Guidelines, Reclean, Remap CSV, Uzupełnij dane z CSV, Wykryj warianty, Audyt AI, weryfikacja obrazów) i **Eksport** (CSV/XLSX, „tylko zatwierdzone", round-trip).
- **Ustawienia** (`projects.$id.index.tsx` → `SettingsCard`) są podzielone na zakładki wg etapów pipeline'u; zawierają m.in. strategię zapytań, knoby szerokości SERP z etykietą kosztową, `scrape_cap`, provider, tryb źródeł.

### 5.12. Podgląd karty produktu (publiczny)

- Trasa: `src/routes/projects.$id.products.$pid_.preview.tsx` — **poza `_auth`**, żeby klient bez konta mógł zobaczyć kartę.
- Dane przez `lib/pim/preview.functions.ts` → `getProductPreview` (serwerowo, admin client po weryfikacji, zwraca tylko dane bezpieczne dla klienta).
- Szablon e-commerce (galeria, tytuł, opis HTML, cechy, cena), bez sidebara i bannerów.

### 5.13. Udostępnianie klientowi

- Trasy publiczne: `/share/$token` (lista) + `/share/$token/p/$pid` (karta).
- `lib/pim/shares.functions.ts` — utwórz link, weryfikuj hasło, listuj produkty, zapisuj feedback.
- `shares-crypto.server.ts` — `pbkdf2Sync(password, salt, 100_000, 32, 'sha256')` (limit CF Workers ≤ 100 000 iteracji). Token = HMAC-SHA256(secret, share_id), weryfikacja serwerowa.

### 5.14. Eksport

- `lib/pim/export.functions.ts` — CSV/XLSX ze złotymi rekordami, kolumny konfigurowalne per projekt, tryby: pełny, „tylko zatwierdzone", **„Dostawa"**.
- `lib/pim/roundtrip-export.functions.ts` + `RoundtripExportDialog` — zwrot pliku klienta **w oryginalnym układzie kolumn** (dzięki `import_row_index`), z uzupełnionymi polami golden.

### 5.15. Narzędzie zdjęć (Photo Tool)

- Trasy `_auth/photo.index.tsx` i `photo.$id.tsx`, logika w `lib/photo-tool/photo-tool.functions.ts`, bulk `PHOTO_TOOL_GENERATE` / `PHOTO_TOOL_EDIT_IMAGE`.
- Pola „Styl" i „Wymagania" mają generowanie i modyfikację przez AI (`suggestPhotoPrompt`, Gemini 3.6 Flash).
- **Prompt per zdjęcie** przy wgraniu wielu plików + `suggestProductPromptFromImages` (Gemini Vision) dobierający prompt do konkretnego produktu.

### 5.16. Serwer MCP

- `src/lib/mcp/index.ts` — `defineMcp` z OAuth Supabase (issuer = bezpośredni URL Supabase, nie proxy).
- Narzędzia: `list_projects`, `get_project`, `list_products`, `get_product`, `start_discovery`, `get_job_status`, `run_audit`, `export_project`.
- Każde narzędzie działa jako zalogowany użytkownik (`supabaseForUser`, RLS); operacje pisane/kosztowne weryfikują własność przed użyciem admina.

### 5.17. Landing page usługi

- `/landing` (+ `/styleguide`): ciemny premium glassmorphism, akcent `#00BC87`, tokeny w `src/styles.css`.
- Sekcje: `Hero` + `HeroDemo`, `ResultsBar`, `CaseStudies` (`#cases`), `HowSection` (`#scope`), `BeforeAfterShowcase`, `ProcessFlow` (`#flow`), `OfferSection` (`#offer`), `PlatformsSection` (`#platforms`), kotwica `#contact`.
- Dane w `src/data/` (`demo-products`, `case-studies`, `stats`, `process-steps`) — liczby, ceny i nazwy klientów są **placeholderami w nawiasach kwadratowych**.
- Komponenty bazowe: `ui-custom/` (GlassCard, Pill, AccentButton, GhostButton, SectionHeading, Container, PageBackground) + `product/ProductCard.tsx`.

---

## 6. Prompt engineering — dobre praktyki (wdrożone)

### 6.1. Generacja/edycja obrazów
- **Nie generuj logo od zera** — pracuj w trybie **edit** na dostarczonym obrazie.
- **Cytuj etykiety dosłownie:** `preserve label "NAZWA" letter-for-letter`.
- **Blokada zmian:** `change only background, keep product, logo, text, colors and proportions EXACTLY the same`.
- **Referencje** — do 8–14 obrazów dla spójności serii; martwe URL-e wykluczane przed wysyłką.
- **Język fotograficzny** — kąt, głębia ostrości, kierunek i temperatura światła (K), obiektyw.
- **Rozdzielczość** — 4K do e-commerce, 2K do social.
- Miniaturki produktowe zawsze przez pipeline `regen` + Bria (białe tło) + QC.

### 6.2. Prompty tekstowe (SEO / Allegro / matching)
- Wyjście zawsze jako **JSON** (`response_format: json_object`) z twardym schematem i whitelistą tagów HTML.
- Matching / preselekcja: `google/gemini-2.5-flash-lite` (tanio, szybko).
- Golden record / audyt: `google/gemini-2.5-flash` (cięższe: `2.5-pro`, `gemini-3.x`).
- Sugestie i wizja: `gemini-3.6-flash` / `gpt-5.5`.
- Prompty mode-aware: inna instrukcja dla `strict` i `compatible`.

---

## 7. Ograniczenia runtime i częste pułapki

### 7.1. Cloudflare Workers (workerd + nodejs_compat)
- **Timeout 30 s** — cokolwiek dłuższego przez `bulk_jobs`.
- **PBKDF2 ≤ 100 000 iteracji.**
- **Brak:** `child_process`, `sharp`, `canvas`, `puppeteer`, `fs.watch`, `os.cpus()`. Sygnał: `[unenv] X is not implemented yet!`.
- **OK:** `fs` (virtual), `path`, `crypto`, `Buffer`, `stream`, `zlib`, fetch, timers.
- **Bundling:** wszystko embed-at-build-time; `ssr.external` w vite.config **złamie build**.

### 7.2. TanStack Start
- `process.env.X` czytać **wewnątrz `.handler()`**.
- W `*.functions.ts` handler body **nie może** odwoływać się do sibling const/function z module scope — splitter je wycina (`ReferenceError` w runtime).
- `requireSupabaseAuth` server function **nie wolno** wołać z loadera publicznej trasy (401 w SSR/prerender). Wołać z komponentu lub loadera pod `_auth`.
- `attachSupabaseAuth` w `src/start.ts` musi być zarejestrowane jako `functionMiddleware`.
- `.single()` na zapytaniu blokowanym przez RLS zawiesza/wywala UI — używać `.maybeSingle()`.
- `src/server/` jest zablokowany dla klienta — używać sufiksu `.server.ts`.

### 7.3. Apify / Firecrawl
- Apify: numeryczne inputy actora (`limit`, `page`, `start`) muszą być **stringami**, inaczej walidacja odrzuca run.
- Firecrawl: SDK zwraca pola bezpośrednio (`result.markdown`), REST bywa wrapped (`result.data.markdown`).
- 402 (insufficient credits) — komunikat użytkownikowi; dlatego cache + Apify-first.
- Antybot: `stealth: true` + residential proxies; detekcja reCAPTCHA/Cloudflare przed zapisem produktu.

### 7.4. FAL AI
- 422 „Could not generate images…" → fallback bez obrazów referencyjnych.
- Async job dla wizualizacji — synchronous timeout w Workers zabiłby request.
- Każdy render kosztuje — stąd guardy (`__imported__`, `manual_lock`, viz-image-guard, merge galerii, QC).

---

## 8. Backlog

**Pipeline dokładności:**
- [ ] Walidacja skuteczności scoringu na dużych projektach (>10k SKU).
- [ ] Auto-detekcja platformy sklepu i dobór ekstraktora zamiast globalnych regexów.
- [ ] Heurystyka „największy obraz z srcset/og:image/JSON-LD" zamiast regexów per platforma.
- [ ] Batchowanie filtra wizualnego Gemini przy dużych projektach.

**Import:**
- [ ] Auto-strip wiodących zer w EAN + walidacja checksumy przy imporcie.
- [ ] Import z linku — kolejka dla >10 URL naraz (dziś sync w handlerze).

**Wizualizacje:**
- [ ] Retry policy dla FAL 422 z eskalacją promptu (dziś jeden fallback).
- [ ] Rate limiting Firecrawl/FAL + twardy budżet per projekt.

**Klient / share:**
- [ ] Powiadomienia email o nowym feedbacku.
- [ ] Wersjonowanie złotych rekordów (history + rollback).

**Operacyjnie:**
- [ ] Testy e2e pipeline'u (Playwright) na fixture-projekcie.
- [ ] Dashboard „zdrowia" bulk_jobs (FAILED, zawieszenia, koszt z `usage`).
- [ ] UI „pokaż odrzucone przez LLM cleaner" (szybka diagnoza pustych wyników).

---

## 9. Mapa kluczowych plików

| Plik | Rola |
|---|---|
| `src/routes/__root.tsx` | Shell HTML, meta tagi |
| `src/routes/index.tsx` | Wejście → `/projects` lub `/login` |
| `src/routes/landing.tsx` / `styleguide.tsx` | Landing usługi / design system |
| `src/routes/_auth.tsx` | Guard autoryzacji |
| `src/routes/_auth/projects.$id.index.tsx` | Widok projektu (lista, akcje masowe, Ustawienia) |
| `src/routes/_auth/projects.$id.products.$pid.tsx` | Edytor produktu |
| `src/routes/projects.$id.products.$pid_.preview.tsx` | Publiczny podgląd karty |
| `src/routes/share.$token*.tsx` | Publiczny share (lista/karta) |
| `src/routes/mcp.ts`, `[.mcp]/`, `[.well-known]/` | Serwer MCP + OAuth discovery |
| `src/routes/api/public/hooks/process-bulk-jobs.ts` | Worker tick |
| `src/lib/pim/_workers.server.ts` | Implementacja wszystkich workerów |
| `src/lib/pim/ingest.functions.ts` / `parsers.ts` | Import CSV + mapowanie kolumn/hierarchii |
| `src/lib/pim/import-urls.functions.ts` | Import z linków |
| `src/lib/pim/firecrawl.functions.ts` / `apify.functions.ts` / `apify.server.ts` | Discovery i providerzy SERP |
| `src/lib/pim/query-variants.ts` | `buildQueryVariants` + `SearchQueryStrategy` |
| `src/lib/pim/serp-preselect.server.ts` | AI preselekcja SERP (strict/compatible) |
| `src/lib/pim/llm-cleaner.server.ts` | LLM czyszczenie opisu + `page_matches_product` |
| `src/lib/pim/matching.functions.ts` | `runMatching`: scoring, cluster dedup, cap |
| `src/lib/pim/compat.functions.ts` | Tryb kompatybilny + `rerunMatchingForProduct` |
| `src/lib/pim/eligibility.ts` | `isPipelineEligible` (excluded / row_kind) |
| `src/lib/pim/variant-detect*.ts` | Wykrywanie i zatwierdzanie wariantów (+ testy) |
| `src/lib/pim/source-cleanup.ts` | `sanitizeProductDescription`, `filterImageUrls` |
| `src/lib/pim/seo.ts` | Prompty golden + Allegro |
| `src/lib/pim/regen.functions.ts` / `media.functions.ts` | Regen miniatury / media |
| `src/lib/pim/thumbnail-qc.ts` / `viz-image-guard.server.ts` | QC miniatury / guard wizualizacji |
| `src/lib/pim/gallery.ts` | **Jedyne** źródło prawdy dla widocznej galerii |
| `src/lib/pim/image-*.ts(.server.ts)` | Probe rozmiaru, warianty, upgrade URL |
| `src/lib/pim/audit.ts` / `audit.functions.ts` / `review.functions.ts` | Audyt i zatwierdzanie |
| `src/lib/pim/export.functions.ts` / `roundtrip-export.functions.ts` | Eksporty |
| `src/lib/pim/preview.functions.ts` | Publiczny podgląd karty |
| `src/lib/pim/shares.functions.ts` / `shares-crypto.server.ts` | Share + PBKDF2/HMAC |
| `src/lib/pim/product-events.*` | Log zdarzeń per produkt |
| `src/lib/pim/worker-kick.server.ts` | Fire-and-forget tick workera |
| `src/lib/mcp/**` | Serwer i narzędzia MCP |
| `src/lib/photo-tool/photo-tool.functions.ts` | Narzędzie zdjęć |
| `src/components/pim/*` | Dialogi UI (Import, Warianty, Wizualizacje, Share, Round-trip…) |
| `src/components/landing|sections|ui-custom|product/*` | Landing page |
| `src/integrations/supabase/*` | AUTO-GEN (klient, admin, middleware, attacher) |
| `src/start.ts` / `src/router.tsx` | Middleware / konfiguracja routera |

---

## 10. Zasady, które trzymamy

1. **Zdjęcia klienta są święte** — sentinel `__imported__` i `manual_lock` blokują każdą regenerację.
2. **Płatne artefakty nie giną** — galerie AI są merge'owane, QC-fail nie kasuje dobrej miniatury.
3. **Jedna definicja kwalifikacji** — `isPipelineEligible` we wszystkich wejściach pipeline'u.
4. **Jedna definicja widocznej galerii** — `getVisibleGallery`, także w eksporcie i share.
5. **Admin dopiero po weryfikacji własności** — nigdy jako sposób na „odblokowanie" odczytu.
6. **Idempotencja workerów** — ponowne uruchomienie nie duplikuje danych ani nie nadpisuje ręcznych korekt.
7. **Koszt jest funkcją produktu** — cache, Apify-first, capy scrape/SERP i telemetria `usage` są częścią pipeline'u, nie dodatkiem.
