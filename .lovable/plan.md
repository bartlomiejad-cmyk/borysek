## Cel

Podgląd karty produktu (`/projects/$id/products/$pid/preview`) ma wyglądać jak realna karta produktu w sklepie e‑commerce, a nie jak surowy dashboard. Dodatkowo naprawiam bug z linkiem „Podgląd karty”, który obecnie prowadzi na listę projektów.

## Zakres zmian

1. **Naprawa linku „Podgląd karty”**
   - W `src/routes/_auth/projects.$id.products.$pid.tsx` link używa ścieżki `/projects/$id/products/$pid_/preview` (route id), a publiczny path to `/projects/$id/products/$pid/preview` — stąd fallback na listę.
   - Poprawię `to` na właściwy publiczny path.

2. **Nowy szablon karty produktu (`ProductPreview`)**
   Przepisuję `src/routes/_auth/projects.$id.products.$pid_.preview.tsx` tak, aby przypominał realny sklep. Sekcje:

   - **Fake shop header (sticky)**: logo „Sklep Demo”, pole wyszukiwania, ikony konta/koszyka, pasek kategorii.
   - **Breadcrumbs**: Sklep › Kategoria › Nazwa produktu.
   - **Główna sekcja 2 kolumny (desktop) / stack (mobile)**:
     - Lewa: duża galeria (main image + miniatury), badge „Nowość” / „Bestseller” jeśli są keywords, lightbox‑style hover zoom (proste `scale`).
     - Prawa: nazwa (H1), marka, ocena gwiazdkowa (statyczna 4.8/5, ~127 opinii — demo), krótki opis (meta description), cena (mock — losowa/placeholder z wyraźnym oznaczeniem „Cena demo”), stan magazynowy „Dostępny”, wybór ilości, duże CTA „Do koszyka” + „Kup teraz”, ikony ulubione/porównaj/udostępnij, boks z ikonami (dostawa 24h, gwarancja, zwrot 30 dni).
   - **Zakładki pod główną sekcją**: Opis / Specyfikacja / SEO preview / Opinie (demo).
     - Opis: `golden_description` w typograficznym `prose`.
     - Specyfikacja: tabela z `golden_features`.
     - SEO preview: obecny snippet Google + meta keywords jako chips.
     - Opinie: 2–3 demo opinie, statyczne.
   - **Sekcja „Podobne produkty”**: 4 puste karty‑szkielety z etykietą „Demo”.
   - **Footer sklepu**: minimalny, żeby domknąć wygląd.

3. **Styl wizualny**
   - Wyłącznie tokeny z design systemu (żadnych `bg-white`, `text-black`, gradientów fioletowych).
   - Typografia: serif dla H1 (już używane w projekcie), sans dla reszty.
   - Karta ma być czysta, jasna, „Apple-like” prostota — bo cel to demo dla klienta.
   - Pasek na górze: subtelny badge „Podgląd demo – dane z Lovable PIM” + przycisk „Wróć do edycji”, żeby nie mylić z prawdziwym sklepem.

4. **Fallback braku Golden Recordu**
   - Zostaje CTA do generacji, ale wyrenderowany w stylu karty (placeholder skeletony), żeby demo wyglądało spójnie.

## Bez zmian
- Backend, dane, zapytania (`getProductDetail`).
- Reszta modułu PIM.

## Weryfikacja
- Otwarcie „Podgląd karty” z edycji produktu → nowa karta z pełnym widokiem sklepu (nie lista projektów).
- Sprawdzenie widoku desktop i mobile (viewport).