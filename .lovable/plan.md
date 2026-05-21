# Naprawa regeneracji teł dla URL-i ze spacjami/UTF-8

## Problem

FAL `fal-ai/bytedance/seedream/v4/edit` zwraca 422 `file_download_error`
dla URL-i ze spacjami i polskimi znakami, np.
`https://e-militaria.pl/133977-large_default/Spłonki Pistoletowe Fiocchi małe BRASS - 150szt.jpg`.
FAL nie potrafi pobrać pliku, bo URL nie jest poprawnie zakodowany.

## Rozwiązanie

Plik: `src/lib/pim/regen.functions.ts`

- Dodaję helper `encodeImageUrl(url)`, który koduje per-segment ścieżki
  (`URL` API + `encodeURIComponent` na każdym segmencie po dekodowaniu),
  bez podwójnego enkodowania już zakodowanych URL-i.
- Stosuję go do `data.imageUrl` przed wysyłką do `seedream/v4/edit`
  i do `image-conversion`.
- W `callFal` wykrywam `422` z `file_download_error` i rzucam czytelny
  komunikat: „FAL nie mógł pobrać źródłowego zdjęcia (zły URL)".
- Pozostawiam resztę logiki bez zmian.

Plik: `src/routes/_auth/projects.$id.index.tsx`

## 1. Podgląd miniaturki zbyt daleko

W `ProductThumbs` podgląd na hover otwiera się przy `r.right + 8, r.top`, ale
wizualnie „odjeżdża" od kciuka. Zmiany:

- zmniejszam odstęp do 4 px,
- jeśli z prawej brakuje miejsca (`r.right + 320 > window.innerWidth`), otwieram
  podgląd po lewej (`left = r.left − 320 − 4`),
- clamp `top` do widocznego ekranu (żeby nie wychodził pod fold),
- nasłuchuję `scroll`/`resize` na czas hovera i zamykam podgląd, żeby nie
  „pływał" po przewinięciu.

## 2. Zaznaczanie produktów + belka akcji masowych

- nowy stan `selectedIds: Set<string>` + helpery `toggleSelected`, `toggleAll`,
  `clearSelected`,
- kolumna `Checkbox` w każdym wierszu tabeli + checkbox „zaznacz wszystkie
  widoczne" w nagłówku (stan `indeterminate`, działa na aktualnie
  przefiltrowanej liście),
- sticky belka nad tabelą widoczna tylko gdy `selectedIds.size > 0`:
  „Zaznaczono N produktów", „Wyczyść", „Generuj złote rekordy",
  „Regeneruj tła", „Eksport CSV/XLSX",
- refaktor `generateAll(productIds?)` i `regenerateAll(productIds?)` —
  gdy podany ID-set, działa tylko na zaznaczonych (z pominięciem filtra
  „status !== GENERATED", żeby można było wymusić regenerację),
- `exportFile` przy zaznaczeniu filtruje wynik eksportu po `selectedIds`,
- istniejące przyciski na górze strony działają dalej dla całej listy
  (gdy nic nie jest zaznaczone).

## Szczegóły techniczne

- używam istniejącego `@/components/ui/checkbox` (shadcn),
- belka: `sticky top-0 z-20 bg-primary/10 border-y border-primary/30`,
- `colSpan` w pustym stanie tabeli zmienia się z 6 na 7.
# Plan: podgląd miniatur + masowy wybór produktów

## 1. Podgląd miniaturki bliżej kursora

W tabeli produktów po najechaniu na pierwsze zdjęcie podgląd otwiera się daleko od miniaturki (efekt „wisi pośrodku ekranu”).

Zmiana w `src/routes/_auth/projects.$id.index.tsx` w komponencie galerii miniaturek:

- Anker podglądu zostaje przy prawej krawędzi miniaturki, ale przed pokazaniem doliczamy realne wymiary kafelka (ok. 320 px max) i zaciskamy pozycję do widocznego obszaru okna (`window.innerWidth/innerHeight`).
- Jeśli po prawej brakuje miejsca, otwieramy podgląd po lewej stronie miniaturki (`left = r.left − width − 8`).
- Jeśli po dole brakuje miejsca, przesuwamy `top` do góry, żeby cały podgląd mieścił się w viewport.
- Odstęp zmniejszamy z 8 px do 4 px, żeby podgląd wizualnie „kleił się” do miniatury.

Efekt: podgląd pojawia się tuż obok kafelka, niezależnie od pozycji w wierszu i bez wypadania poza ekran.

## 2. Zaznaczanie produktów i pasek akcji masowych

Na liście „Produkty” dodajemy mechanizm zaznaczania wielu wierszy i wspólny pasek akcji.

Zakres w `src/routes/_auth/projects.$id.index.tsx`:

- Stan `selectedIds: Set<string>` w komponencie strony.
- Nowa kolumna z lewej w tabeli z `Checkbox` (`src/components/ui/checkbox.tsx`) na każdy wiersz; w nagłówku checkbox „zaznacz wszystkie widoczne” (z filtrowaną listą `filtered`).
- Zaznaczenie/odznaczenie aktualizuje `selectedIds`; zmiana filtra/wyszukiwarki nie kasuje zaznaczeń, ale checkbox „zaznacz wszystkie” odnosi się tylko do widocznych pozycji.
- Sticky pasek akcji nad tabelą (widoczny tylko gdy `selectedIds.size > 0`):
  - tekst „Zaznaczono N produktów”,
  - „Wyczyść”,
  - „Generuj złote rekordy (zaznaczone)” — wywołuje istniejący `generateAll` ograniczony do zaznaczonych id (refaktor: `generateAll(productIds?: string[])`),
  - „Regeneruj tła (zaznaczone)” — analogicznie dla `regenerateAll`,
  - „Eksport zaznaczonych do CSV/XLSX” (filtrowanie wyniku `exportProject` po `id`).
- Istniejące przyciski u góry strony (Generuj/Regeneruj/Eksport) działają dalej dla całej listy, gdy nic nie jest zaznaczone.

## Pliki do zmiany

- `src/routes/_auth/projects.$id.index.tsx`

## Szczegóły techniczne

- Pozycjonowanie podglądu liczone po `getBoundingClientRect()` miniaturki + stałe `PREVIEW_W = 320`, `PREVIEW_H = 360` (uwzględnia pasek z wymiarami), `GAP = 4`. Wybór strony (prawo/lewo) i clamp do `[8, window.innerWidth − PREVIEW_W − 8]` / analogicznie dla pionu.
- `selectedIds` trzymane w `useState<Set<string>>`; helper `toggleSelected(id)`, `toggleAll(visibleIds)`, `clearSelected()`. Pasek renderowany jako `sticky top-0 z-20` w obrębie karty „Produkty”.
- Refaktor `generateAll` i `regenerateAll`: przyjmują opcjonalną listę `productIds`; bez argumentu działają na `filtered` jak dotychczas.