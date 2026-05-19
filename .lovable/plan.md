# Extra images + hover zoom + dimensions

## Cel
Na liście produktów (`/projects/$id`) pokazać również zdjęcia "extra" (obecnie ukryte za przełącznikiem `include_extra_images` tylko w widoku szczegółów). Po najechaniu na miniaturę pokazać powiększony podgląd z rozdzielczością obrazu (szer. × wys. px).

## Zmiany

1. **`src/lib/pim/queries.functions.ts` → `listProductsWithEnrichment`**
   - Zawsze dołączaj `extra_images` z `product_sources` do listy obrazów produktu (niezależnie od ustawienia projektu — użytkownik prosi o widoczność na liście).
   - Zwiększ limit obrazów per produkt z 6 do np. 12, aby zmieściły się extra.

2. **`src/routes/_auth/projects.$id.index.tsx` → `ProductThumbs`**
   - Pokaż do ~5 miniatur (zamiast 3), wszystkie dostępne (main + extra).
   - Po najechaniu myszą na miniaturę pojawia się "floating preview" — powiększony obraz (np. 320px) wyświetlany nad listą (pozycjonowany absolutnie, `pointer-events-none`).
   - W rogu powiększenia pokaż rozdzielczość: `1200 × 800`. Wymiary pobierane z `naturalWidth/naturalHeight` po załadowaniu obrazu (cache w `useState` lub `useRef<Map>`).
   - Klik nadal otwiera dialog (zachowane).

## Detale techniczne

- Hover preview: jeden wspólny stan `hovered: { url, x, y } | null` w `ProductThumbs`, renderowany jako pływający element nad miniaturami. Wymiary czytane przez `new Image()` lub `<img onLoad>` i cache'owane w `Map<string, {w,h}>` przez `useRef`.
- Dimensions badge: mały overlay w prawym-dolnym rogu powiększenia, `bg-black/70 text-white text-xs`.
- Wymiary nie są zapisywane w bazie — pobierane lazy po stronie klienta.

## Pliki
- `src/lib/pim/queries.functions.ts` (dołączenie extra_images)
- `src/routes/_auth/projects.$id.index.tsx` (komponent `ProductThumbs` + hover preview)
# Naprawa: brak miniatur na liście produktów

## Co się dzieje
Lista produktów (`/projects/$id`) prawie nigdy nie pokazuje miniatur, choć na stronie szczegółów produktu zwykle widać przynajmniej jedno zdjęcie. Po wejściu w detal pojawia się 1 zdjęcie z jednego z dopasowanych źródeł — czyli dane w bazie są poprawne, tylko zapytanie listy ich nie pobiera.

## Przyczyna
Server function `listProductsWithEnrichment` pobiera zdjęcia jednym zapytaniem do `product_sources` z filtrem `.in("url", allUrls)`, gdzie `allUrls` to **wszystkie unikalne URL-e z `picked_urls` wszystkich produktów projektu** (w tym projekcie ~1500 URL-i).

PostgREST przekłada `.in(...)` na parametr URL. Przy 1500 długich URL-ach (każdy ~80–200 znaków) zapytanie HTTP przekracza limit długości URL (~8 KB) i kończy się błędem albo zwraca pustą tablicę. Efekt: `imgMap` jest pusty, więc każdy produkt dostaje `images: []` i miniatury się nie renderują.

Strona szczegółów (`getProductDetail`) działa, bo pyta tylko o 3 URL-e jednego produktu — mieści się bez problemu.

## Plan naprawy

1. **Zmienić strategię w `listProductsWithEnrichment` (`src/lib/pim/queries.functions.ts`):**
   - Zamiast filtrować `product_sources` po liście tysięcy URL-i, pobrać po prostu wszystkie wiersze projektu jednym zapytaniem: `select("url, images, extra_images").eq("project_id", projectId).limit(5000)`. W tym projekcie to ~226 wierszy — trywialnie mało.
   - Reszta logiki (mapowanie po URL, filtr `hidden_images`, łączenie z `extra_images` gdy włączone) bez zmian.

2. **Drobne wzmocnienie:** w obu zapytaniach (`listProductsWithEnrichment`, `getProductDetail`) sprawdzić błąd z `from("product_sources")` i zalogować — żeby następnym razem nie szukać po omacku, gdyby coś jeszcze zwróciło błąd.

## Co NIE zmieniam
- Schematu bazy, RLS, ingestu, dopasowania, scrapingu.
- Komponentu `ProductThumbs` — jest poprawny, problem był wyłącznie po stronie zapytania.
