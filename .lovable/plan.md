# Plan: documentation.md dla całego projektu

Utworzę plik `documentation.md` w roocie projektu, zawierający pełną dokumentację systemu PIM w języku polskim, gotową do wklejenia do Claude jako kontekst do dalszej optymalizacji procesu.

## Struktura dokumentu

### 1. Przegląd projektu
- Cel narzędzia (PIM: import produktów → wzbogacenie danych ze źródeł web → generacja złotych rekordów + wizualizacji → eksport / share dla klienta)
- Główni użytkownicy i typowy workflow end-to-end

### 2. Stack technologiczny
- TanStack Start v1 + React 19 + Vite 7
- Cloudflare Workers (workerd + nodejs_compat) — ograniczenia runtime
- Supabase (DB, Auth, Storage, RLS) — jako "Lovable Cloud"
- Lovable AI Gateway (Gemini, GPT-4o, Gemini Vision)
- Firecrawl v2 (scrape, search, map, stealth/residential proxies)
- FAL AI (generacja/edycja obrazów, background removal Bria)

### 3. Architektura kodu
- Struktura folderów (`src/routes/`, `src/lib/pim/`, `src/components/pim/`, `src/integrations/supabase/`)
- Podział server functions (`*.functions.ts`) vs server-only (`*.server.ts`) vs public API routes (`src/routes/api/public/*`)
- Middleware auth (`requireSupabaseAuth`) + attacher w `src/start.ts`
- Bulk jobs (`bulk_jobs` + worker w `_workers.server.ts` + cron hook `process-bulk-jobs`)

### 4. Model danych (Supabase)
Skrótowy opis tabel z ich rolą:
- `projects`, `source_products`, `product_sources`, `search_results`
- `enrichments` (matched terms, picked_urls, image_scores, golden records)
- `bulk_jobs` (kolejka: FIRECRAWL_DISCOVERY, PIM_VISUALIZATIONS, itp.)
- `imported_extract` (dane z importu z linku)
- `project_shares`, `client_feedback`
- `user_roles` (role via has_role security definer)

### 5. Kluczowe procesy (pipeline)
Dla każdego procesu: cel → input → kroki → output → znane pułapki.

**5.1. Import produktów**
- CSV (`ImportCsvDialog` → `parsers.ts` → `ingest.functions.ts`) — mapowanie kolumn, obsługa zdjęć z CSV (`pinned_main_url`, sentinel `__imported__`), problem wiodących zer w EAN
- Import z linków (`ImportUrlsDialog` → `import-urls.functions.ts`) — JSON-LD, `<h1>.product-name`, meta, ekstrakcja marki/MPN, detekcja reCAPTCHA/Cloudflare, tryb stealth (Firecrawl residential proxies)

**5.2. Discovery źródeł (Firecrawl)**
- `startFirecrawlDiscovery` → bulk job → search + scrape
- Filtr marketplace'ów (`MARKETPLACE_DOMAINS`)
- Ekstrakcja regionu produktu (`extractProductRegionHtml`, `stripRelatedProductBlocks`)
- Upgrade miniatur → duże obrazy (WooCommerce, Shopify, Magento, IdoSell, Speed-line: `/ai/140/` → `/ai/2000/`)
- Filtr wizualny Gemini Vision (`image_scores.is_banner_or_trash`)

**5.3. Matching (`runMatching`)**
- Strategie: EAN / NAZWA / HYBRID
- Sanityzacja opisów (`sanitizeProductDescription`, `DESC_HEADING_RE`, `DESC_CUT_HEADINGS`)
- Filtr obrazów (`filterImageUrls`)
- AI-walidacja źródeł (Gemini Flash Lite) — opcjonalnie
- Scoring (`scoreSource`: długość opisu, EAN w tytule/opisie, dopasowanie tokenów nazwy, liczba obrazów)
- Cap **TOP 5** na produkt

**5.4. Generacja złotych rekordów / SEO**
- `GOLDEN_SEO_SYSTEM_PROMPT` w `src/lib/pim/seo.ts`
- Format opisu: `<h3>` z nazwą + akapity + `<ul>` cechy
- `sanitizeGoldenDescriptionHtml`
- Wariant Allegro: `ALLEGRO_DESCRIPTION_SYSTEM_PROMPT` (bloki, zestaw, wypunktowania)

**5.5. Regeneracja miniatury**
- FAL edit → `flattenToWhiteBackground` → Bria background remove
- Wymuszone `#FFFFFF` tło, zakaz zmiany koloru/logo/proporcji
- Fallback bez obrazów referencyjnych przy 422

**5.6. Wizualizacje AI**
- `GenerateVisualizationsDialog` + `suggestVisualizationField` (GPT-4o) + analiza Gemini Vision
- Async kolejka FAL, wyniki w `ai_gallery_urls`
- Bulk job `PIM_VISUALIZATIONS`

**5.7. Podgląd karty produktu**
- Trasa `_auth/projects.$id.products.$pid_.preview.tsx`
- Ukryty sidebar/topbar, brak bannera demo

**5.8. Udostępnianie klientowi**
- `/share/$token` + `/share/$token/p/$pid`
- Hasło PBKDF2 (100k iteracji — limit Workers), HMAC token
- `ShareProjectDialog`, `client_feedback` (komentarze anonimowe)

**5.9. Eksport**
- `export.functions.ts` — CSV eksport złotych rekordów

### 6. Prompt engineering — dobre praktyki (już wdrożone)
Sekcja opisująca wypracowane zasady:
- Dosłowne cytowanie etykiet w cudzysłowach
- Blokada logo/proporcji/koloru
- Wymuszony język fotograficzny (kąt, DoF, temperatura światła)
- Preferowany model edycji zamiast generacji od zera
- Referencje 8–14 obrazów dla spójności
- 4K e-commerce / 2K social
- Weryfikacja i regeneracja

### 7. Ograniczenia runtime i częste pułapki
- Cloudflare Workers timeout 30s → wszystko ciężkie → bulk jobs
- PBKDF2 max 100k iteracji
- Brak `child_process`, `sharp`, `puppeteer`, `fs.watch`
- `process.env` czytać wewnątrz `.handler()`, nie na module scope
- Server functions w `*.functions.ts` — handler body nie może referować sibling const/function ze scope modułu (splitter je usuwa)
- Import protection: `src/server/` zablokowany dla klienta; używać `*.server.ts`
- Auth: server functions z `requireSupabaseAuth` nie wolno wołać w loaderze publicznej trasy (401 przy prerender)

### 8. Znane problemy do dopracowania (backlog)
Sekcja "TODO / do przemyślenia z Claude" — otwarte tematy:
- Skuteczność scoring/cap TOP 5 na dużych projektach
- Jakość sanityzacji opisów dla nowych sklepów (regex-based → rozważyć LLM cleaner jako fallback)
- Ekstrakcja dużych obrazów dla nowych platform (obecnie ręczne dodawanie regex)
- Wiodące zera w EAN przy imporcie CSV (auto-strip vs. przycisk)
- Retry policy dla FAL 422
- Rate limiting dla Firecrawl / kolejkowanie bulk jobów
- Testy end-to-end dla pipeline'u

### 9. Załącznik: mapa kluczowych plików
Tabela plik → rola (najważniejsze ~30 plików z `src/lib/pim/`, `src/routes/`, `src/components/pim/`).

## Zakres
- Jeden plik: `documentation.md` w roocie, ~600–900 linii, po polsku
- Zero zmian w kodzie
- Dokument jest samowystarczalny do wklejenia do Claude jako kontekst
