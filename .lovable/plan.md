# Galeria wybranych zdjęć w karcie „Złoty Rekord"

## Co dodajemy

Pod sekcją „Zdjęcie główne (FAL.ai)" w karcie „Złoty Rekord" (strona produktu) pojawia się nowy blok **„Wybrane zdjęcia"** — galeria wszystkich nie-ukrytych zdjęć z dopasowanych źródeł (czyli to, co tak naprawdę „wchodzi" do złotego rekordu i co trafi na export). Dziś te zdjęcia są widoczne tylko w prawej kolumnie podzielone per źródło — brakuje jednego, scalonego widoku.

## Jak to wygląda

- Grid 4 kolumny (na mobile 2): kwadratowe miniaturki ~h-24 z `object-contain` na białym tle, zaokrąglone, z borderem.
- Pierwsza miniaturka = aktualne `mainUrl` (przypięte lub auto-wybrane), oznaczona obwódką primary i badgem „Główne". Pozostałe sortowane przez istniejący `scoreFor()` — czyli ta sama logika rankingu, której używa `top4`.
- Na każdej miniaturce w rogu:
  - mała pinezka (`Pin`/`PinOff`) → wywołuje istniejący `pinFn({ enrichmentId, url })`, toggle przypięcia,
  - krzyżyk → wywołuje istniejący `hideFn({ enrichmentId, url })` (ukrywa zdjęcie z wybranych).
- Klik w miniaturkę otwiera ten sam `Dialog` z dużym podglądem co reszta strony.
- Pod galerią mały licznik: „N zdjęć · M ukrytych" + link „Pokaż ukryte" (opcjonalne — jeśli `hidden_images.length > 0`), który pokazuje dodatkowy rząd ukrytych miniaturek z przyciskiem `unhideFn`. Jeśli już dziś istnieje gdzieś przycisk „przywróć ukryte" na stronie, nie duplikujemy — sprawdzimy podczas implementacji.
- Stan pusty: „Brak zdjęć z dopasowanych źródeł." gdy `allVisible.length === 0`.

## Szczegóły techniczne

- Plik: `src/routes/_auth/projects.$id.products.$pid.tsx`. Bez zmian w server functions ani DB.
- Dane wejściowe są już w komponencie: `allVisible`, `hiddenSet`, `mainUrl`, `pinnedMainUrl`, `imageMeta`, `imageScores`, `scoreFor`, `enrichment.id`, mutacje `pinFn`/`hideFn`/`unhideFn`.
- Nowy sub-komponent (inline w pliku) `SelectedGallery` renderowany w karcie „Złoty Rekord" zaraz po bloku „Zdjęcie główne (FAL.ai)", przed polem „Nazwa".
- Sortowanie: `[...allVisible].sort((a,b) => (b===mainUrl?1:0)-(a===mainUrl?1:0) || scoreFor(b)-scoreFor(a))`.
- Drag&drop pomijamy — pinezka wystarcza, lista produktów już ma DnD.

## Test akceptacyjny

Na stronie produktu „TAC-22 kal.22LR NORMA":
1. Pod sekcją FAL.ai widać siatkę miniaturek wszystkich nie-ukrytych zdjęć z 10 źródeł.
2. Aktualne zdjęcie główne ma obwódkę i badge „Główne".
3. Klik pinezki na innej miniaturce zmienia „Główne" i odświeża `mainUrl` powyżej.
4. Klik X ukrywa zdjęcie — znika z galerii i z listy źródeł po prawej.
# Lista produktów — więcej zdjęć, przypinanie głównego (drag&drop), regeneracja (też masowo)

## Problem

Na liście produktów (`/projects/$id`) w kolumnie „Zdjęcia" często widać tylko 1 miniaturkę zamiast nawet 8. Powód: `queries.functions.ts → listProductsWithEnrichment` przepuszcza zdjęcia przez `pickImages(...)`, który twardo odrzuca wszystko poniżej 600×600 i — jeśli żadne zdjęcie nie ma wymiarów w `image_meta` (czyli zanim odpalimy „Generuj złote rekordy" / verifySources) — zwraca tylko jedno najlepsze zdjęcie. Dla bardzo wielu produktów `image_meta` jest puste, więc lista pokazuje pojedyncze miniaturki.

Dodatkowo dziś nie da się z poziomu listy:
- ustawić zdjęcia głównego (działa tylko na stronie produktu),
- zlecić regeneracji tła (działa tylko na stronie produktu i tylko 1 na 1).

## Co zrobimy

### 1. Więcej zdjęć na liście
W `listProductsWithEnrichment` przestajemy ograniczać miniaturki listy filtrem 600px. Zwracamy wszystkie nie-ukryte zdjęcia z dopasowanych źródeł, posortowane: najpierw te które przeszłyby próg (`>=600px` wg `image_meta`), potem reszta wg powierzchni / kolejności, do `MAX = 12`. `hidden_images` dalej obowiązuje. Strona produktu pozostaje bez zmian (tam filtr jakości ma sens).

### 2. Przypinanie głównego zdjęcia z listy (drag & drop)
Komponent `ProductThumbs` na liście pokazuje gwiazdkę/badge „Główne" na zdjęciu które jest aktualnie przypięte (`enrichments.pinned_main_url`). Pierwszy slot listy renderujemy jako „strefę docelową": użytkownik przeciąga dowolną miniaturkę produktu na ten slot → wywołujemy istniejący `setPinnedMainImage({ enrichmentId, url })`. Bez enrichmentu (brak dopasowania) drag jest wyłączony z tooltipem „Najpierw dopasuj i wygeneruj". Każda miniaturka dodatkowo ma mały przycisk „pin/odepnij" (jak na stronie produktu), żeby działało też bez drag.

`listProductsWithEnrichment` zaczyna zwracać `pinned_main_url` oraz upewnia się że zawsze zwraca `enrichment_id` (już istnieje, ale dziś tylko czytane jako `id` z rozszerzenia typu — wczytujemy `id` jawnie w SELECT). Sortowanie miniaturek na liście: przypięte zawsze pierwsze.

### 3. Regeneracja z listy (per produkt + masowo)
Per wiersz: ikonka „Regeneruj tło" obok strzałki → wywołuje `regenerateMainImage({ enrichmentId, imageUrl: pinned_main_url ?? thumbnail })`. Disable kiedy brak enrichmentu lub brak zdjęcia.

Masowo: nowy przycisk w nagłówku „Regeneruj tła" obok „Generuj złote rekordy". Cele = przefiltrowana lista (`filtered`) z `enrichment_id` i jakimkolwiek zdjęciem. Pętla z `CONCURRENCY = 5` (jak `generateAll`), pasek postępu w istniejącym slocie `genProgress` (albo równoległy `regenProgress`). Po każdej udanej regeneracji invalidate `["project", id, "products"]`. Domyślnie regenerujemy zdjęcie przypięte; jeśli brak — pierwsze widoczne.

## Szczegóły techniczne

- `src/lib/pim/queries.functions.ts`
  - `listProductsWithEnrichment`: dołożyć `id, pinned_main_url, regenerated_main_image` do SELECT enrichmentów; w mapowaniu wynikowym zwrócić `pinned_main_url`, `regenerated_main_image`, `enrichment_id` (z prawdziwego `id`). Zastąpić `pickImages(...).slice(0, 8)` lokalną funkcją `pickThumbsForList(urls, meta, hidden, pinned)` która: usuwa `hidden`, sortuje (pinned → big≥600 desc area → rest desc area → kolejność), zwraca top 12.
- `src/routes/_auth/projects.$id.index.tsx`
  - Import `setPinnedMainImage` z `@/lib/pim/enrichments.functions` i `regenerateMainImage` z `@/lib/pim/regen.functions`.
  - `ProductThumbs` dostaje `pinnedUrl`, `enrichmentId`, `onPin(url)`, `onRegen()`. Obsługa HTML5 DnD: `draggable` na każdej miniaturce, slot „Główne" z `onDragOver` + `onDrop`. Mały przycisk pinezki w rogu miniaturki (toggle).
  - Nowy przycisk nagłówka „Regeneruj tła" + pasek postępu (osobny stan `regenProgress`).
  - Per-wiersz przycisk „Regeneruj" w kolumnie akcji.
- Bez zmian: schemat DB, RLS, `regen.functions.ts`, `enrichments.functions.ts`, prompt FAL, strona produktu.

## Test akceptacyjny

1. Otwórz listę projektu, w którym wcześniej widać było tylko 1 miniaturkę → teraz widać do 12.
2. Przeciągnij dowolne zdjęcie z wiersza na slot „Główne" → pojawia się badge „Główne", a na stronie produktu to samo zdjęcie jest oznaczone jako przypięte.
3. Klik „Regeneruj" w wierszu → po chwili miniaturka się odświeża (regenerated_main_image używany przez stronę produktu).
4. Klik „Regeneruj tła" w nagłówku → pasek postępu, leci po liście, po zakończeniu lista odświeżona.
# Naprawa promptu regeneracji FAL.ai

## Problem

1. Tło wygenerowanego zdjęcia jest kremowe/beżowe zamiast czysto białego (#FFFFFF).
2. Z pudełka zniknęły napisy i grafiki produktowe (logo Norma, TAC-22, .22 LR, zdjęcie strzelca, pasek z parametrami 2.6/40 330/1083) — model je wymazał lub przerysował.

Oba problemy biorą się z aktualnego promptu w `src/lib/pim/regen.functions.ts`:

- Fraza „clean pure white seamless studio background" jest dla modelu zbyt miękka — interpretuje to jako „jasne studio", co wychodzi kremowo.
- Fraza **„no text, no extra objects"** dosłownie każe modelowi usunąć cały tekst — więc kasuje również napisy nadrukowane na pudełku.

## Rozwiązanie

Zmieniam tylko prompt do `fal-ai/bytedance/seedream/v4/edit` (krok 1). Reszta pipeline'u (konwersja na WebP, upload, zapis URL) bez zmian.

Nowy prompt opiera się na dwóch zasadach:

- **Tło: czyste #FFFFFF**, bez gradientu, ciepłego światła, papieru ani tekstury.
- **Produkt 1:1** — całe opakowanie, wszystkie nadruki, logo, kolory, kształt, proporcje. Model ma tylko wyciąć produkt i przenieść na białe tło z miękkim cieniem, nie przerysować go.

Treść nowego promptu (EN, bo model lepiej rozumie):

> Move the exact same product onto a pure white seamless studio background. The background color must be #FFFFFF, RGB 255,255,255 — no warm tint, no gradient, no paper texture. Keep the product identical to the input image: preserve every printed label, logo, brand name, illustration, color, material and proportions exactly as in the source — do NOT redraw, restyle or remove any packaging text or graphics. Add a soft realistic contact shadow directly under the product. Center the product, occupying ~70 percent of the frame, even margins. Sharp focus, professional e-commerce product photography, accurate colors. Avoid: cream background, beige, off-white, missing labels, blurred text, regenerated artwork.

Seedream v4 nie ma osobnego pola `negative_prompt`, więc zakazy wpisujemy do `prompt` na końcu.

## Co zostaje bez zmian

- Wymiary 2560×2560, `num_images: 1`, `sync_mode: true`.
- Konwersja do WebP, bucket `regenerated-images`, kolumna `enrichments.regenerated_main_image`.
- UI (przycisk Regeneruj/Cofnij, pin „Główne", lista źródeł).

## Szczegóły techniczne

Plik: `src/lib/pim/regen.functions.ts`, jedyna zmiana to wartość pola `prompt` w body wysyłanym do `fal-ai/bytedance/seedream/v4/edit`.

Jeżeli po tej zmianie tło dalej wychodzi kremowe w pojedynczych przypadkach, następnym krokiem (poza tym planem) byłoby:

- dodać drugi etap „white-background normalize" przez `fal-ai/imageutils/rembg` + kompozycję na płótnie #FFFFFF po stronie serwera, albo
- przełączyć krok 1 na model dedykowany do product-shotów.

## Test akceptacyjny

Dla produktu „Amunicja Norma TAC-22":

1. Kliknąć „Regeneruj ponownie" na przypiętym zdjęciu z czerwonym pudełkiem.
2. Wynik powinien mieć:
   - tło czyste białe (pipetka ≈ #FFFFFF, nie #F5EFE6),
   - widoczne logo „norma", napis „TAC-22", „.22 LR", zdjęcie strzelca, pasek z parametrami „2.6/40 330/1083",
   - nabój obok pudełka, miękki cień pod produktem.