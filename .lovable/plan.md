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
