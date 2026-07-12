## Problem

Worker `runPimVisualization` poprawnie zapisuje wygenerowane wizualizacje do `enrichments.ai_gallery_urls`, a lista produktów już pobiera to pole (`listProductsWithEnrichment`). Mimo to:
- **Karta edycji produktu** (`projects.$id.products.$pid.tsx`) w ogóle nie renderuje sekcji z wizualizacjami — pokazuje tylko główne zdjęcie i galerię źródłową.
- **Lista produktów w projekcie** nie sygnalizuje, że produkt ma wizualizacje (kolumna miniatury bierze tylko `pickThumbsForList` z picked/product_sources; brak licznika/badge).

Efekt: użytkownik uruchamia „Wizualizacje", job kończy się sukcesem, ale nic nie widać w UI mimo że dane są w bazie (widoczne w podglądzie karty `/preview` i eksporcie).

## Zakres zmian (tylko frontend)

### 1. `src/routes/_auth/projects.$id.products.$pid.tsx`
Dodać nową sekcję **„Wizualizacje AI"** pod istniejącym blokiem zdjęcia głównego / galerii:
- Render siatki miniatur z `enrichment.ai_gallery_urls` (klik → otwarcie w nowej karcie).
- Pusty stan: „Brak wygenerowanych wizualizacji — użyj akcji Wizualizacje na liście projektu".
- Każdy kafelek z przyciskiem „Usuń" (mutacja `updateEnrichmentGallery` — patrz niżej), żeby użytkownik mógł wywalić nietrafione rendery.
- Ewentualny przycisk „Ustaw jako główne" (`setPinnedMainImage` już istnieje) — do decyzji podczas implementacji, ale bezpieczny bo tylko wywołuje istniejący serverFn.

### 2. `src/routes/_auth/projects.$id.index.tsx` (lista)
Dodać w komórce ze statusem/miniaturką mały wskaźnik dla produktów z `ai_gallery_urls.length > 0`:
- Badge „🎨 N" pod miniaturą albo w kolumnie akcji.
- Kiedy produkt nie ma `thumbnail`, użyć pierwszej wizualizacji jako fallback miniatury (żeby nie było pustego kwadratu po samym generowaniu wizualizacji).

### 3. Nowa akcja usuwania — serverFn
Dodać do `src/lib/pim/enrichments.functions.ts` prostą funkcję `removeGalleryUrl({ enrichmentId, url })`, która zdejmuje URL z `ai_gallery_urls` (analogicznie do istniejącej `hideImage`). Niezbędna dla „Usuń" w punkcie 1.

## Poza zakresem
- Bez zmian w workerze / promptach / bulk-jobs.
- Bez zmian w podglądzie karty `/preview` (już renderuje `ai_gallery_urls`).
- Bez migracji DB.

## Weryfikacja
1. Otworzyć produkt, dla którego job `PIM_VISUALIZATIONS` się zakończył → sekcja „Wizualizacje AI" pokazuje kafle.
2. Wrócić na listę projektu → produkt ma badge „🎨 N".
3. Kliknąć „Usuń" na kaflu → znika z karty, znika z listy w kolejnym renderze, znika też z `/preview`.
