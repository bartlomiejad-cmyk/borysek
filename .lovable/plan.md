
## Cel
W widoku edycji produktu w projekcie PIM dodać przycisk **„Podgląd karty produktu"**, który otwiera pełnoekranową wizualizację karty produktowej zbudowaną z danych ze **złotego rekordu** (golden_name, golden_description, cechy, SEO, główne zdjęcie + galeria, w tym wizualizacje AI). Ma to służyć demo dla klienta: pokazujemy pusty produkt „przed", a po ~5 minutach otwieramy podgląd „po".

## Zakres

1. **Nowa strona-podgląd (route)**
   - `src/routes/_auth/projects.$id.products.$pid.preview.tsx`
   - Loader: używa istniejącego `getProductDetail` (server fn) — bez nowych zapytań.
   - Layout imitujący realną kartę sklepu:
     - Lewa kolumna: główne zdjęcie (priorytet: `pinned_main_url` → `regenerated_main_image` → pierwsze z galerii), pod spodem miniatury (galeria źródłowa + `ai_gallery_urls`), klik = zmiana głównego.
     - Prawa kolumna: `golden_name` jako H1, SKU/EAN/MPN jako meta, sekcja opisu (`golden_description` renderowany jako HTML/markdown), tabela cech (`golden_features` key/value), sekcja SEO na dole (slug, meta description, keywords) w zwijanym akordeonie „Podgląd SEO / Google snippet".
     - Symulowany „Google snippet" (title + URL + meta description) — atrakcyjny efekt demo.
   - Wersja przyjazna do prezentacji: szeroki kontener, brak sidebaru PIM, jasny/ciemny wariant zgodny z motywem projektu.

2. **Przycisk w edytorze produktu**
   - `src/routes/_auth/projects.$id.products.$pid.tsx`: dodać w toolbarze przycisk **„Podgląd karty"** (ikona `Eye`), otwierający nową trasę w nowej karcie (`target="_blank"`).
   - Wariant zapasowy: przycisk „Kopiuj link do podglądu".

3. **Fallback gdy brak złotego rekordu**
   - Jeśli `golden_name`/`golden_description` są puste → pokazać stan „Brak złotego rekordu — wygeneruj najpierw «Złote rekordy»" z linkiem powrotnym. To pozwala pokazać „before/after" na demo.

## Poza zakresem
- Bez zmian w backendzie / server functions / bazie.
- Bez publicznego, niezalogowanego linku do udostępniania na zewnątrz (można dodać później jako osobny etap).
- Bez edycji danych — widok czysto read-only.

## Pliki do zmiany/utworzenia
- **Nowy:** `src/routes/_auth/projects.$id.products.$pid.preview.tsx`
- **Edycja:** `src/routes/_auth/projects.$id.products.$pid.tsx` (dodanie przycisku „Podgląd karty")

Czy zgadzasz się, żeby podgląd był pod trasą `_auth` (wymaga logowania), czy chcesz publiczny link do wysłania klientowi bez logowania (to wymagałoby osobnego etapu z tokenem)?
