# Naprawa: zdjęcia „extra" nadal nie pojawiają się na liście

## Co sprawdziłem
- W bazie produkt „12/70 24g OLYMPIC SKEET 9-2,0mm" ma 10 `picked_urls`. Tylko 3 z nich mają zescrapowane strony: `kolba.pl` (1 główne + 3 extra), `twojabron.pl` (1 + 1), `sklep.janczewski.com.pl` (1 + 0). Razem powinno być 7 miniatur.
- W widoku szczegółów (panel po prawej w screenshocie) zdjęcia „extra" pojawiają się poprawnie — dane w bazie są OK.
- `listProductsWithEnrichment` pobiera `extra_images` i scala je z `images`, ale w wierszu listy widać tylko jedną miniaturę.

## Najbardziej prawdopodobna przyczyna
`ProductThumbs` ma twardy limit `images.slice(0, 5)`. Dla wielu produktów z kilkoma źródłami ta piątka mieści tylko pierwsze miniatury, a dopiero w środku/na końcu listy są obrazy oznaczone w bazie jako `extra`. Wizualnie wygląda to jakby „extra" nie były dołączone.

Dodatkowo nie ma żadnego oznaczenia, które miniatury pochodzą z `extra_images`, więc nawet jeśli się pokażą, nie sposób tego potwierdzić wzrokowo.

## Plan zmian

1. **`src/lib/pim/queries.functions.ts`**
   - W `listProductsWithEnrichment` zwracać oprócz `images` także zbiór adresów oznaczonych jako extra (np. `extra_image_urls: string[]`), żeby front mógł je wizualnie odróżnić.
   - Kolejność pozostaje: dla każdego `picked_url` najpierw `images`, potem `extra_images` tego samego źródła.

2. **`src/routes/_auth/projects.$id.index.tsx` (`ProductThumbs`)**
   - Pokazywać wszystkie zebrane miniatury w układzie `flex-wrap`, z kompaktowym licznikiem `+N` gdy jest ich więcej niż np. 8 (zamiast twardego `slice(0, 5)`).
   - Miniatury z `extra_image_urls` dostają subtelną ramkę / mały badge „extra" w rogu, żeby było widać, że są dołączone.
   - Zostawiamy powiększenie po najechaniu i wyświetlanie rozdzielczości.

3. **Świeższe dane na liście**
   - Ustawić `staleTime: 0` (lub `refetchOnMount: 'always'`) dla query produktów na stronie projektu, żeby po zmianie danych w bazie lista odświeżała się bez twardego reloadu strony.

## Co zostaje bez zmian
- Schemat bazy, matching, eksport, ukrywanie zdjęć, widok szczegółów.
