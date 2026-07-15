## Diagnoza

Analiza sceny (Gemini Vision, `analyzeVisualizationSceneForProduct`) dostaje jako obrazy URL-e stron produktowych zamiast URL-i zdjęć. W `src/lib/pim/_workers.server.ts` (linie ~3437-3446):

```ts
const analysisCandidates: string[] = [];
if (e.pinned_main_url) analysisCandidates.push(e.pinned_main_url);        // OK – URL zdjęcia
if (e.regenerated_main_image && e.regenerated_main_image !== "__imported__") {
  analysisCandidates.push(e.regenerated_main_image);                       // OK – URL zdjęcia
}
for (const u of e.picked_urls ?? []) {
  if (u && u !== "__imported__") analysisCandidates.push(u);               // BŁĄD – to URL-e stron sklepów
}
```

`enrichments.picked_urls` to URL-e stron ofert (np. `https://gruboo.pl/filtry-do-rekuperatora-.../`), a nie plików obrazów. Gemini je pobiera, dostaje `text/html`, i AI Gateway odrzuca requesta:

> `AI gateway 400: URL did not return an image (received text/error content): https://gruboo.pl/...`

Retry trafia w ten sam błąd → wpada w `fallback: bezpieczna scena generyczna` → prompt gubi rzeczywistą charakterystykę produktu, a spójność referencji spada do „1/3 pasuje do referencji głównej”. Efekt kaskadowy: wizualizacje generują się „na ślepo”, dlatego wychodzą nietrafione i cała partia (`0/5`) przechodzi do kolejnego przebiegu.

## Naprawa

W `_workers.server.ts`, w budowaniu `analysisCandidates`:

1. Zastąpić iterację po `picked_urls` iteracją po prawdziwych URL-ach zdjęć z akceptowanej galerii — dokładnie tak samo jak eksport delivery, tzn. przez `product_sources.images` (+ `extra_images` jeżeli `include_extra_images`) filtrowane przez `getVisibleGallery` (bez martwych, bez rejected, bez unsure). To już istnieje w kodzie edytora i eksportu — użyję tego samego wzorca.
2. Defensywny filtr per URL: przepuszczaj tylko `http(s)://…` z rozszerzeniem obrazu (`\.(jpe?g|png|webp|gif|avif)(\?|$)`) lub hostem znanego CDN zdjęć — cokolwiek innego pomijaj. To ostatnia linia obrony przed identycznym błędem, gdyby ktoś kiedyś znów wpuścił URL strony.
3. Zachować dotychczasową kolejność priorytetów: `pinned_main_url` → `regenerated_main_image` (bez sentynela `__imported__`) → następnie do 2 dodatkowych zdjęć z galerii akceptowanej. Górny limit `slice(0, 4)` bez zmian.
4. Jeśli po odsianiu zostaje 0 kandydatów: nie wywołuj Gemini Vision w ogóle, przejdź od razu do fallbacku projektowego/generycznego z komunikatem „brak zdjęć źródłowych, pomijam analizę sceny” (zamiast dwóch prób z gwarantowanym 400 i mylącym logiem).
5. Ustawić `has_text=false` w tym „brak zdjęć” ścieżce (zachowawcze — nie mamy dowodu na obecność brandingu).

Zmiana chirurgiczna, wyłącznie w bloku „Per-product AI scene analysis” — nie ruszam pipeline'u renderu, promptu ani spójności referencji.

## Walidacja

Ten sam produkt Wanas: kolejne uruchomienie wizualizacji ma pokazać:
- log „analizuję scenę per produkt (gemini-2.5-pro, N zdj)” z N wynikającym z akceptowanej galerii, bez błędu 400,
- brak wpisu „URL did not return an image”,
- „spójność referencji: 3/3 pasuje do referencji głównej” (lub co najmniej 2/3),
- render partii `5/5` w tym samym przebiegu (o ile FAL nie zwróci własnego błędu).