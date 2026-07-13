## Cel
Umożliwić usuwanie produktów z projektu PIM — pojedynczo (z listy i edytora) oraz masowo (dla zaznaczonych).

## Zakres

### 1. Server function — `src/lib/pim/products.functions.ts` (nowy plik)
Dwie funkcje z `requireSupabaseAuth`:
- `deleteProducts({ projectId, productIds: string[] })` — walidacja `z.array(uuid).min(1).max(500)`.
- Wewnątrz: `supabase.from("source_products").delete().eq("project_id", projectId).in("id", productIds)`.
- `enrichments` znika automatycznie (FK `ON DELETE CASCADE` na `source_product_id`).
- Zwraca `{ deleted: number }`.
- RLS na `source_products` już scopuje przez projekt/usera, więc nie trzeba dodatkowej autoryzacji, ale i tak weryfikujemy że projekt należy do zalogowanego usera (jeden SELECT `projects.id`).

Nie ruszamy `product_sources` ani `search_results` — są per-projekt, nie per-produkt (współdzielone przez discovery).

### 2. UI — lista `src/routes/_auth/projects.$id.index.tsx`
- **Pojedynczo:** w kolumnie akcji każdego wiersza dodać ikonę kosza (`Trash2`) obok istniejących akcji, otwierającą `AlertDialog` „Usuń produkt X? Tej operacji nie można cofnąć".
- **Masowo:** w istniejącym pasku „Zaznaczono N produktów" dodać czerwony przycisk **„Usuń zaznaczone"** (destructive variant, ikona `Trash2`) → `AlertDialog` z listą pierwszych ~5 nazw i licznikiem.
- Po sukcesie: toast, `qc.invalidateQueries(["project", id])`, czyszczenie `selectedIds`.

### 3. UI — edytor `src/routes/_auth/projects.$id.products.$pid.tsx`
- W nagłówku edytora (obok „Podgląd karty") dodać przycisk **„Usuń produkt"** (destructive-ghost) → `AlertDialog` → po usunięciu `router.navigate({ to: "/projects/$id", params: { id } })`.

## Nie robimy
- Nie dodajemy „soft delete" / kosza — użytkownik nie prosił, a złożoność zapisu w tabelach downstream (zadania masowe, wizualizacje) byłaby duża.
- Nie przerywamy aktywnych `bulk_jobs` — jeśli w trakcie usuwania trwa job, worker po prostu pominie brakujące produkty (`enrichments` już nie istnieje). Zostaje bez zmian.

## Techniczne detale
- Kaskada: `source_products` → `enrichments` (już `ON DELETE CASCADE`), więc jedna operacja DELETE wystarczy.
- Limit 500 na wywołanie zabezpiecza przed timeoutem Workera; masowe usuwanie >500 zaznaczonych chunkujemy po stronie klienta jak inne akcje.
- Klucz zapytania `["project", id]` już jest w użyciu — jedno `invalidateQueries` odświeży wszystko.

## Test manualny
1. Zaznacz 3 produkty → „Usuń zaznaczone" → znikają z listy, licznik projektu spada.
2. Ikona kosza w wierszu → potwierdź → produkt znika.
3. W edytorze produktu → „Usuń produkt" → wraca na listę projektu.
4. Odśwież stronę — usunięte produkty nie wracają.
