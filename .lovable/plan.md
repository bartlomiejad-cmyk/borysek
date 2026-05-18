# Naprawa eksportu CSV

## Problem

Eksportowany CSV otwiera się w Excelu "rozjechany" — kolumny się nie zgadzają. Przyczyny:

1. **Excel PL używa `;` jako separatora**, a my eksportujemy z `,`. Excel wrzuca wtedy całą linię do jednej kolumny lub psuje podział.
2. **Brak BOM UTF-8** — polskie znaki (ą, ę, ó) mogą się sypać w Excelu.
3. **Opisy zawierają znaki nowej linii** (`\n`). Papa.unparse cytuje je poprawnie (`"..."`), ale niektóre programy bez wsparcia RFC4180 traktują każdy `\n` jako nowy wiersz — stąd 5672 linii zamiast 523 produktów.

## Plan

1. W `src/routes/_auth/projects.$id.index.tsx` w funkcji `exportFile("csv")`:
   - Dodać BOM (`\uFEFF`) na początku pliku.
   - Użyć `Papa.unparse(rows, { delimiter: ";", newline: "\r\n", quotes: true })` — średnik dla Excel PL, CRLF jako koniec wiersza (standard CSV/Excel), wymuszone cudzysłowy wokół każdej wartości (bezpieczne dla wielolinijkowych opisów).
   - MIME zostaje `text/csv;charset=utf-8`.

2. XLSX zostaje bez zmian — nie ma problemu z separatorami.

## Szczegóły techniczne

```ts
const csv = "\uFEFF" + Papa.unparse(rows, {
  delimiter: ";",
  newline: "\r\n",
  quotes: true,
});
const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
```

Po tej zmianie plik otwarty dwuklikiem w Excelu PL pokaże 523 wiersze z prawidłowym podziałem na kolumny i poprawnymi polskimi znakami.
