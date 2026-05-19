# Rozbudowa: zdjęcia, weryfikacja, cechy, eksport, mapowanie CSV

Plan dotyczy 6 powiązanych obszarów. Większość to dołożenie nowych pól (cechy, ukryte zdjęcia, opcje projektu), reszta to UI + jedna nowa funkcja AI (weryfikacja).

## 1. Miniatury zdjęć + ręczne ukrywanie „babolów"

- Na liście produktów (`/projects/$id`) zamiast jednej miniatury pokazujemy **stos do 3 miniatur** (klik = duży podgląd w dialogu).
- Pod każdą miniaturą — ikonka „🗑 ukryj" — odkłada URL zdjęcia do listy ukrytych w danym `enrichment`.
- Na karcie produktu (`/projects/$id/products/$pid`) w sekcji „Źródła" każde zdjęcie z `images` dostaje ten sam przycisk usuń.
- Ukryte zdjęcia są pomijane wszędzie (lista, eksport, widok weryfikacyjny, prompt AI). Nic nie usuwamy ze źródeł — tylko flagujemy, więc da się cofnąć.

## 2. Widok weryfikacyjny + AI quality-check

Nowa trasa `/projects/$id/verify` — galeria kafelków po jednym na produkt, na kafelku:
- nazwa (golden lub źródłowa), do 3 miniatur, skrócony opis (golden), tabela cech.
- przycisk **„Sprawdź AI"** uruchamia `verifyProduct` (server fn → Lovable AI `google/gemini-2.5-flash`, multimodal), prompt dostaje nazwę, cechy i URL-e zdjęć. Model zwraca JSON:
  `{ "watermark_urls": [...], "name_mismatch": false, "feature_mismatches": [...], "notes": "..." }`
- wynik trafia do nowej kolumny `enrichments.quality` (jsonb). Na kafelku zielony „OK" albo czerwony badge z listą problemów.
- batch „Sprawdź wszystkie" — kolejka z progresem, 5 równolegle, analogicznie do generowania złotych rekordów.

## 3. Eksport: URL zdjęć

`exportProject` dokłada kolumny: `image_1`, `image_2`, `image_3`, `images_all` (pełna lista po `|`). Zdjęcia z dopasowanych źródeł, z odjęciem ukrytych (pkt 1), z extra zgodnie z togglem (pkt 4).

## 4. Zdjęcia z `extraProperties.images` (opcjonalnie)

- W ustawieniach projektu nowy switch **„Uwzględniaj zdjęcia z extraProperties"** (`projects.include_extra_images bool default false`).
- Nowa kolumna `product_sources.extra_images jsonb`. `parseProductJson` zawsze parsuje obie listy i zapisuje rozdzielnie: `images` (główne) i `extra_images` (additionalProperties/extraProperties).
- Konsumenci łączą obie listy tylko gdy toggle jest włączony — jednym helperem.

## 5. Generowanie cech (features) z extraProperties / opisu / nazwy

- Nowa kolumna `enrichments.golden_features jsonb default '[]'` — lista `{ key, value }`.
- Na karcie produktu, pod opisem, edytowalna tabela cech + przycisk **„Wygeneruj cechy AI"**.
- Server fn `generateFeatures(productId)`:
  - czyta `source_products.raw` (zwykle ma `extraProperties` / `additionalProperties`) + opisy ze źródeł + nazwę,
  - prompt JSON do Lovable AI → `{ features: [{key, value}] }`,
  - sanitize blacklistą, zapis do `golden_features`.
- Eksport dokłada `features_json` (raw JSON) i `features_text` (`klucz: wartość | …`).

## 6. Mapowanie kolumny „kod" w Source CSV (i przy okazji EAN/nazwa/id)

- Nowe pola w `projects`: `code_column`, `ean_column`, `name_column`, `id_column` (text, default ''). Puste = obecna auto-detekcja.
- Zakładka Ustawienia → sekcja **„Mapowanie Source CSV"** z 4 inputami.
- `parseCsv` przyjmuje opcjonalny mapping i najpierw próbuje ręcznych nazw kolumn, potem fallback do heurystyki. Mapping wczytywany z `projects` przed uploadem.

## Szczegóły techniczne

### Migracja DB
```sql
ALTER TABLE projects
  ADD COLUMN include_extra_images boolean NOT NULL DEFAULT false,
  ADD COLUMN code_column text NOT NULL DEFAULT '',
  ADD COLUMN ean_column  text NOT NULL DEFAULT '',
  ADD COLUMN name_column text NOT NULL DEFAULT '',
  ADD COLUMN id_column   text NOT NULL DEFAULT '';

ALTER TABLE product_sources
  ADD COLUMN extra_images jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE enrichments
  ADD COLUMN hidden_images   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN golden_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN quality         jsonb;
```

### Server fns
- `queries.functions.ts` — `listProductsWithEnrichment` zwraca `images[]` (do 3, z odjętymi ukrytymi, z extra jeśli toggle), `getProductDetail` zwraca `golden_features`, `hidden_images`, `quality` i pełne `images + extra_images` per źródło.
- `enrichments.functions.ts` (nowy) — `hideImage`, `unhideImage`, `updateFeatures`.
- `ai.functions.ts` — dodaje `generateFeatures` i `verifyProduct`.
- `export.functions.ts` — dokłada `image_*`, `images_all`, `features_text`, `features_json`.
- `ingest.functions.ts` + `parsers.ts` — `parseCsv` przyjmuje mapping kolumn; `parseProductJson` rozdziela `images` i `extra_images`; `ingestProductSources` zapisuje obie kolumny.

### UI
- `projects.$id.index.tsx`: kolumna miniatur (stack 3 + dialog), context-menu „ukryj zdjęcie", link „Widok weryfikacyjny", w Ustawieniach sekcja mapowania CSV + switch extra-images.
- `projects.$id.products.$pid.tsx`: tabela cech (edytowalna) + przycisk „Wygeneruj cechy", przycisk „Ukryj" przy każdym zdjęciu źródła, podgląd `quality`.
- `projects.$id.verify.tsx` (nowa): siatka kafelków, batch „Sprawdź AI", filtr „tylko z problemami".

### Bez zmian
Logika matchingu, auth, parser Search JSON, motyw, layout.

## Kolejność wdrożenia (po akceptacji)
1. Migracja DB (5 kolumn w 3 tabelach).
2. Backend: parsery + ingest + queries + export.
3. UI listy + ustawienia (mapowanie CSV, switch extra, miniatury, ukrywanie).
4. Karta produktu: cechy + ukrywanie zdjęć + `generateFeatures`.
5. Widok weryfikacyjny + `verifyProduct`.
6. Smoke test CSV/XLSX i całego flow.
