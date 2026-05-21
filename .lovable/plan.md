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