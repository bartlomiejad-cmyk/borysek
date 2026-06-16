## Cel
Po wgraniu pliku CSV w dialogu „Wgraj produkty z CSV" pokazać podgląd zawartości w tabeli, żeby było widać nagłówki i przykładowe wartości — łatwiejsze zmapowanie kolumn.

## Zmiana (jeden plik)
`src/components/pim/ImportCsvDialog.tsx`:

1. Poszerzyć dialog do `max-w-5xl` (obecnie `max-w-2xl`), aby zmieścić tabelę.
2. Pod sekcją „Mapowanie kolumn" dodać sekcję „Podgląd danych":
   - Tabela (`<Table>` z `@/components/ui/table`) opakowana w `<ScrollArea>` o `max-h-[280px]` i poziomym scrollu.
   - Nagłówki: `csv.headers`.
   - Wiersze: pierwsze **20** z `csv.rows` (każde pole obcięte do ~80 znaków z `title` dla pełnej wartości).
   - Pod tabelą: „Pokazano 20 z N wierszy" (gdy N > 20).
3. **Highlight zmapowanych kolumn** — kolumna w tabeli odpowiadająca aktualnie wybranej wartości w którymś z 4 selectów (`mapping`) dostaje subtelne tło (`bg-primary/10`) + małą etykietę pod nagłówkiem („ID", „Nazwa", „Kod", „EAN"). Dzięki temu użytkownik widzi w czasie rzeczywistym jak mapowanie wpływa na dane.

## Co NIE zmienia się
- Logika parsowania (`parseCsvRaw`), mapowanie, ingest, czyszczenie — bez zmian.
- Inne komponenty (RemapCsvDialog, ingest.functions) bez zmian.

## Weryfikacja
Otworzyć dialog, wgrać CSV → widoczna tabela z nagłówkami i pierwszymi 20 wierszami; zmiana w selectach podświetla odpowiednią kolumnę.
