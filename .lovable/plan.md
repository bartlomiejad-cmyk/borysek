## Problem

Klikając „Podgląd karty" trafiasz z powrotem do listy/edycji produktu, bo trasa `projects.$id.products.$pid.preview.tsx` jest **dzieckiem** trasy `projects.$id.products.$pid.tsx`. Rodzic (strona edycji) nie renderuje `<Outlet />`, więc dziecko (`/preview`) nie ma gdzie się zamontować i zamiast podglądu ładuje się rodzic.

Rozwiązanie: odciąć zagnieżdżenie — podgląd ma być pełnoekranową, samodzielną trasą pod tym samym URL-em, nie wewnątrz layoutu edycji.

## Zmiana

1. Zmiana nazwy pliku trasy podglądu (TanStack „escape nesting" znakiem `_`):
   - z `src/routes/_auth/projects.$id.products.$pid.preview.tsx`
   - na `src/routes/_auth/projects.$id.products.$pid_.preview.tsx`

2. W tym samym pliku zaktualizować deklarację:
   - `createFileRoute("/_auth/projects/$id/products/$pid_/preview")`
   URL widoczny dla użytkownika pozostaje `/projects/:id/products/:pid/preview` (podkreślnik jest tylko sygnałem dla routera, że trasa nie jest zagnieżdżona w rodzicu).

3. W pliku edycji produktu poprawić `<Link to=...>` z `"/projects/$id/products/$pid/preview"` na `"/projects/$id/products/$pid_/preview"` (bez zmiany `params` i `target="_blank"`).

4. `src/routeTree.gen.ts` regeneruje się automatycznie — nie ruszamy.

## Efekt

Podgląd karty otwiera się w nowej karcie jako pełny widok karty produktu (bez layoutu edycji), bez powrotu do listy.
