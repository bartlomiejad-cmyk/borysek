# Universal AI Product Enricher & PIM

Aplikacja webowa do wzbogacania baz produktowych (CSV) o dane scrapowane (JSON), z wynikami Google jako mostem mapującym i AI generującym "Złoty Rekord".

## Stack

- TanStack Start + React + Tailwind + Lucide + shadcn/ui
- Lovable Cloud (Postgres + Auth + Storage)
- Lovable AI Gateway (Gemini — `google/gemini-3-flash-preview`)

## Etapy

### 1. Cloud + Auth
- Włączenie Lovable Cloud.
- Auth: email/hasło + Google (przez broker Lovable).
- Dane projektów scope'owane per user.

### 2. Schemat bazy

Tabele (RLS: właściciel widzi tylko swoje):
- `projects` — kontener (id, user_id, name, custom_prompt, blacklist[], strategy, created_at).
- `source_products` — wiersze z CSV (id, project_id, ext_id, nazwa, kod, ean, raw jsonb).
- `search_results` — rozparsowany Search JSON (id, project_id, term, organic_urls jsonb).
- `product_sources` — rozparsowane Product JSONy (id, project_id, url, title, description, images jsonb, raw jsonb).
- `enrichments` — wynik per produkt (id, source_product_id, status, match_type, picked_urls text[], golden_name, golden_description, model, generated_at).
- Storage bucket `uploads` na oryginalne pliki.

### 3. Upload & parsing
- Strona `/projects/$id` z trzema strefami drop:
  - CSV (PapaParse w przeglądarce, walidacja kolumn `id, nazwa, kod, ean`).
  - Search JSON (mapowanie `searchQuery.term` → `organicResults[].url`).
  - Product JSONs (multi-file, keyed by `url`).
- Upload do Storage + server function inserting parsed rows w batchach.

### 4. Silnik mapowania

Server function `runMatching(projectId, strategy)`:
- `EAN`: szuka `search_results.term == ean`.
- `NAZWA`: `term == nazwa`.
- `HYBRID`: `term == nazwa + " " + ean`, fallback do EAN, potem NAZWA.
- Pobiera Top 3 URL z `organic_urls`, joinuje z `product_sources`.
- Zapisuje wynik + `match_type` ("EAN Match" / "Name Match" / "No Match") do `enrichments`.

### 5. AI Content Factory

Server function `generateGoldenRecord(enrichmentId, opts)`:
- Wejście: do 3 `product_sources` + `custom_prompt` + `blacklist` z projektu.
- Wywołanie Lovable AI Gateway (`generateText` z `Output.object`) — zwraca `{ name, description }`.
- Post-processing: usuwa wszystkie wystąpienia słów/domen z blacklisty (case-insensitive, też w URL-ach).
- Tryby:
  - `all` — wszystkie 3 źródła naraz (domyślne).
  - `single(url)` — regeneracja tylko z jednego URL (Source Switcher).
- Batchowanie: kolejka po stronie klienta, max 5 równoległych, progress bar, pauza/wznawianie (zakres 100–1000).

### 6. UI

- **Dashboard** (`/projects/$id`): tabela produktów (miniaturka z pierwszego źródła, nazwa CSV, EAN, status badge, akcja "Otwórz"). Filtry po statusie. Bulk "Generuj wszystko".
- **Side-by-Side** (`/projects/$id/products/$pid`):
  - Lewa: Złoty Rekord (edytowalne name/description, Regeneruj all, Zapisz).
  - Prawa: 3 karty źródeł (URL, tytuł, miniaturka, fragment opisu) + przycisk "Użyj tylko tego źródła" → `single(url)`.
- **Ustawienia projektu**: strategy radio, custom prompt textarea, blacklist (chips input), zarządzanie plikami.

### 7. Eksport

Server function `exportProject(projectId, format)`:
- Buduje wiersze (oryginalne kolumny CSV + `golden_name`, `golden_description`, `match_type`, `source_urls`).
- CSV: PapaParse unparse.
- XLSX: SheetJS (`xlsx`).
- Zwraca blob, klient pobiera.

## Bezpieczeństwo

- RLS na każdej tabeli (`user_id = auth.uid()`).
- `LOVABLE_API_KEY` tylko po stronie serwera.
- Walidacja inputów (Zod) w każdej server function.
- Custom prompt jako user message (nie system) + limit długości.

## Szczegóły techniczne

- Strategia: enum `EAN | NAZWA | HYBRID`.
- Match URL → product_source: lookup po dokładnym URL; jeśli brak, źródło oznaczone "missing data".
- ext_id z CSV trzymane jako stabilny klucz biznesowy.
- Regeneracja Source Switcher nadpisuje pola; poprzednia wersja trzymana w `enrichments.previous` jsonb.

## Następny krok

Po akceptacji planu poproszę o wgranie przykładowych plików Search JSON i Product JSON, żeby dostosować parser do realnej struktury przed kodowaniem.
