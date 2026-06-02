# Dlaczego „nic się nie wydarzyło"

Przycisk „Wyczyść źródła" istnieje **tylko** na stronie projektu (`/projects/$id`). Zrzut pokazuje, że jesteś na widoku produktu (`/projects/$id/products/$pid`), gdzie tego przycisku nie ma — w logach sieciowych nie ma żadnego requestu do `recleanProductSources`. Czyli nie kliknąłeś tego, co myślałeś.

Dodatkowo, nawet gdybyś kliknął, sito ma luki widoczne na Twoim screenie:
- logo „FAM" (zdjęcie 6) — czysty brand mark, bez tokenów chrome w URL
- w opisie: angielski blok adresu sklepu („only available in our stationary store", „[41‑253 Czeladź]…", link do Google Maps, godziny „MON. – FRI.")
- linki `(https://www.google.com/maps/...)` w markdown.

# Plan

## 1. Przycisk dostępny tam, gdzie efekt ma być widać
Dodać „Wyczyść źródła" w dwóch miejscach (oprócz istniejącego w `projects.$id.index.tsx`):
- `src/routes/_auth/projects.$id.products.$pid.tsx` — w nagłówku obok „Wróć / Generuj". Po sukcesie invaliduje `["product", id, pid]`, więc lewy i prawy panel od razu się odświeżą.
- `src/routes/_auth/projects.$id.verify.tsx` — w pasku akcji. Invaliduje query weryfikacji.

Każdy przycisk:
- toast sukcesu ze statystykami (`updated/scanned`, usunięte zdjęcia, usunięte znaki)
- jeśli `updated === 0` → `toast.info("Wszystkie źródła już wyczyszczone")`
- przy błędzie → `toast.error(friendlyError(...))`

## 2. Rozszerzenie sita opisu (`source-cleanup.ts`)
Dodać do `DESC_BLOCK_PHRASES` (regex case‑insensitive):
- `only available in our stationary store`
- `installments? for this product`
- `stationary store`
- `mon\.?\s*[-–]\s*fri\.?` (godziny otwarcia EN)
- `pon\.?\s*[-–]\s*pt\.?` (PL)
- `working hours?`, `opening hours?`

Dodać nowe sito linii „adres + mapa":
- Linia zawierająca `google\.com/maps` → usunąć całą linię.
- Linia w stylu `[KOD‑POCZTOWY MIASTO...] (https://...)` → usunąć.
- Standalone link markdown `[…](https://www.google.com/maps/…)` → usunąć.

Dodać cięcie po nagłówku `Contact|Address|Adres|Sklep stacjonarny|Stationary store`.

## 3. Rozszerzenie sita obrazów
Dodać do `JUNK_FILENAME_TOKENS`: `brand`, `producent`, `manufacturer`, `marka`.

UWAGA: logo „FAM" w URL z `kolba.pl` najpewniej nie zawiera słowa „logo". Bezpieczne wykrycie brand‑logo bez kontekstu produktu jest niewykonalne deterministycznie (false‑positive może wyrzucić zdjęcia produktu z marką na opakowaniu). Dla tych zostawiamy ręczne ukrywanie (UI już to ma — przycisk `hideImage`). W planie świadomie tego nie automatyzujemy.

## 4. Tooltip / hint na przycisku
Dodać `title` informujący, że operacja jest bezpieczna i działa lokalnie (bez ponownego scrape'u Firecrawl, bez kosztu).

# Pliki
- `src/lib/pim/source-cleanup.ts` — rozszerzone frazy + nowe sito linii adresu/mapy.
- `src/routes/_auth/projects.$id.products.$pid.tsx` — przycisk + handler.
- `src/routes/_auth/projects.$id.verify.tsx` — przycisk + handler.

# Bez zmian
- Schemat DB, serwerowa funkcja `recleanProductSources` (już zwraca komplet statystyk), worker scrape.
