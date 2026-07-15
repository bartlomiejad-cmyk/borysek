## Zmiana w trybie eksportu „Dostawa (tylko nowe dane)"

Obecnie tryb `delivery` zapisuje cechy jako jedną kolumnę `cechy` z wartościami połączonymi separatorem ` | ` (np. `Rozmiar: 10cm | Długość: 2m`). Zmieniam to tak, żeby każda cecha miała własną kolumnę — dokładnie tak jak już robią tryby `client` i `qc`.

### Efekt w CSV/XLSX

Zamiast:

```
id  | golden_name | cechy
1   | Filtr X     | Rozmiar: 10cm | Długość: 2m | Przeznaczenie: rekuperator
```

Będzie:

```
id  | golden_name | cecha_Rozmiar | cecha_Długość | cecha_Przeznaczenie
1   | Filtr X     | 10cm          | 2m            | rekuperator
```

### Szczegóły techniczne

Edytuję `src/lib/pim/export.functions.ts`, gałąź `if (mode === "delivery")`:

- Usuwam kolumnę `cechy` z wiersza.
- Wstawiam `...featureCols` (już wyliczone wyżej dla `client`/`qc`) — to daje kolumnę `cecha_<klucz>` dla każdej cechy z projektu, wartość wypełniona tylko dla produktów, które ją mają (pozostali dostają pusty string, więc CSV/XLSX zachowuje spójny nagłówek).
- Klucze są już normalizowane (`normalizeKey`: trim, spacje/średniki → `_`) i sortowane alfabetycznie po polsku — kolejność kolumn będzie stabilna między eksportami tego samego projektu.
- Bez zmian w trybach `client` i `qc`, bez zmian w hostowaniu obrazów, bez zmian w UI.

### Uwaga

Nazwy kolumn będą miały prefiks `cecha_` (tak samo jak w pozostałych trybach — dla spójności i dla uniknięcia kolizji nazw z innymi kolumnami, np. gdyby cecha nazywała się „id" albo „ean"). Jeśli wolisz nagłówki bez prefiksu (czyste „Rozmiar", „Długość"), powiedz — zmienię to tylko dla trybu Dostawa.