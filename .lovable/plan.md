## Problem

Obecnie „Wgraj produkty" (UploadZone → `handleSourceCsv`) idzie od razu w `parseCsv` z polami `id_column / name_column / code_column / ean_column` wziętymi z konfiguracji projektu. Jeśli któraś nie jest ustawiona w projekcie, kolumna leci jako `null` i potem trzeba ratować się „Uzupełnij dane z CSV". Użytkownik chce mapowania **już na etapie wgrywania**.

## Rozwiązanie

Zamiast jednoklikowego uploadu — dwukrokowy flow w jednym dialogu:

1. Wybór pliku CSV.
2. Dialog z preview nagłówków + 4 selecty mapowania (`ID`, `Nazwa`, `Kod`, `EAN`), prefillowane z ustawień projektu (jeśli są). Każde pole można zmienić lub ustawić „— pomiń —".
3. Po „Wczytaj" — parsuje, kasuje stare `source_products`, wstawia nowe (jak dziś).

Dialog jest osobny od istniejącego `RemapCsvDialog` (tamten patchuje istniejące produkty bez klucza, ten robi pełny import z mapowaniem).

### Pliki

- `src/components/pim/ImportCsvDialog.tsx` — **nowy**. Wybór pliku + selecty mapowania + checkbox „Wyczyść poprzednie produkty" (domyślnie ON, jak dziś). Wywołuje `clearProjectData` + `ingestSourceProducts` w batchach.
- `src/lib/pim/parsers.ts` — **dodać** wariant `parseCsvWithMapping(file, mapping)` przyjmujący jawne mapowanie nagłówek → pole (zamiast nazw z projektu). Stare `parseCsv` zostaje dla wstecznej kompatybilności / wewnętrznych użyć.
- `src/routes/_auth/projects.$id.index.tsx` — zastąpić obecny `UploadZone title="Wgraj produkty"` komponentem `ImportCsvDialog` (przekazując projectId, defaults z `meta.project`, callback `refetchProducts`). `handleSourceCsv` usuwam.

### Zachowuję bez zmian

- Pozostałe dwa UploadZone (search JSON, products JSON) — bez zmian, nie mają problemu z mapowaniem.
- `RemapCsvDialog` — bez zmian, dalej dostępny do post-importowego poprawiania.
- Konfiguracja kolumn w ustawieniach projektu — bez zmian; służy jako domyślne mapowanie w dialogu.

### Czego świadomie nie robię

- Nie zmieniam schematu bazy ani server functions ingestowych.
- Nie zmieniam zachowania innych uploadów.
- Nie zapisuję wybranego mapowania jako nowych ustawień projektu (można dodać później jako checkbox „Zapamiętaj mapowanie").
