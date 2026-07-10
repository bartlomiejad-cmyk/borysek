Ukryj boczne menu AI Enricher na stronie podglądu karty produktu.

Zmiana tylko w `src/routes/_auth.tsx`:
- Pobrać aktualny `pathname` przez `useRouterState`.
- Ustawić flagę `isFullscreen = pathname` kończy się na `/preview`.
- Gdy `isFullscreen` jest `true`:
  - nie renderować desktopowego `<aside>` (sidebar),
  - nie renderować mobilnego `<header>` z hamburgerem,
  - usunąć klasę `md:ml-[260px]` z głównej kolumny, żeby zajmowała pełną szerokość.
- Reszta aplikacji (Projekty, Katalog, Weryfikacja, edycja produktu itp.) zachowuje boczne menu bez zmian.

Punkt 1 z poprzedniego planu (dekodowanie HTML w opisie) — pominięty zgodnie z decyzją użytkownika.