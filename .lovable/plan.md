## Problem

Dialog "Wgraj produkty z CSV" (`src/components/pim/ImportCsvDialog.tsx`) rozjeżdża się przy większych plikach:

- `DialogContent` nie ma limitu wysokości ani wewnętrznego scrolla — przy 632 wierszach + szerokiej tabeli treść wypycha stopkę z przyciskami **Anuluj / Wczytaj** poza ekran (widać to na screenshocie).
- `ScrollArea` z `min-w-max` w środku nie ma poziomego `ScrollBar`, więc szerokiej tabeli nie da się przewinąć w bok.

## Zakres zmian (tylko frontend, jeden plik)

`src/components/pim/ImportCsvDialog.tsx`:

1. `DialogContent` → `max-w-5xl max-h-[90vh] flex flex-col p-0` + wewnętrzne sekcje w układzie:
   - `DialogHeader` — sticky top (`shrink-0`, padding).
   - Scrollowalny środek (`flex-1 overflow-y-auto px-6`) zawierający opis, wybór pliku, mapowanie kolumn i podgląd danych.
   - Sticky footer (`shrink-0 border-t px-6 py-3`) z checkboxem "Wyczyść poprzednie" oraz przyciskami **Anuluj / Wczytaj** — zawsze widoczny.

2. Podgląd tabeli:
   - `ScrollArea` z jawną wysokością `h-[280px]` + dodać `<ScrollBar orientation="horizontal" />` (import z `@/components/ui/scroll-area`), żeby dało się przewinąć szeroką tabelę w poziomie.

## Brak zmian

Bez zmian w logice parsowania, mapowania, ingestu, backendu i innych komponentach.
