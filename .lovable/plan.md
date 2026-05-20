# Brak zdjęć „extra" u drugiego użytkownika — diagnoza

## Co znalazłem w bazie
Drugi użytkownik (login przez Google) ma jeden projekt „Bron":
- 226 rekordów `product_sources`, z czego **0 ma cokolwiek w `extra_images`**.
- Wszystkie 523 rekordy `enrichments` mają **dokładnie 3 `picked_urls`** (stary, obcięty zapis).

Czyli to nie jest bug w kodzie — kod listy działa, ale po prostu **nie ma czego pokazać**:
- `extra_images` w `product_sources` są puste, bo dane zostały wgrane plikiem, w którym tej kolumny nie było (albo była pusta).
- `picked_urls` zostały zapisane jeszcze przed naprawą obcięcia do 3 — dlatego nawet po dorzuceniu `extra_images` widać tylko 3 źródła zamiast wszystkich.

Twoje konto ma świeższe projekty wykonane po poprawkach, dlatego u Ciebie zdjęcia „extra" są.

## Co musi zrobić drugi użytkownik (bez zmian w kodzie)
1. Ponownie wgrać `product_sources` z pliku, który ma wypełnioną kolumnę `extra_images` (to po stronie ich pipeline'u scrapera — aplikacja sama nie scrapuje stron).
2. Wcisnąć **„Dopasuj"** w projekcie — to przepisze `picked_urls` w `enrichments` pełną listą URL-i (bez obcinania do 3), zgodnie z aktualnym kodem `runMatching`.

Po tych dwóch krokach miniatury „extra" pojawią się na liście tak samo jak u Ciebie.

## Opcjonalna zmiana w aplikacji (do decyzji)
Jeżeli chcesz, mogę dodać na stronie projektu mały komunikat / przycisk „Odśwież dopasowanie i obrazy" pokazujący się, gdy w projekcie są enrichments z `array_length(picked_urls) <= 3` albo `product_sources` bez `extra_images` — żeby drugi użytkownik dostał wyraźną podpowiedź zamiast zgadywać. To czysto UI, bez ruszania logiki backendu.

## Co zostaje bez zmian
Schemat bazy, matching, scraping, eksport, widok szczegółów, układ miniatur na liście — wszystko jest sprawne, problem dotyczy wyłącznie starych danych w jednym projekcie.
