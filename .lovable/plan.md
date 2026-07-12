
## Cel
Dodać osobne pole „Opis Allegro" wraz z generatorem AI zbudowanym wg dobrych praktyk aukcji Allegro (blokowy layout obraz|tekst, mocno sprzedażowy język, wypunktowania, sekcja „Zawartość zestawu", parametry). Uruchamiane pojedynczo z karty produktu oraz masowo w projekcie PIM.

## Dobre praktyki, które zaszyjemy w prompcie
Na podstawie oficjalnych wytycznych Allegro (Strefa Sprzedawcy „Opis oferty", pomoc.allegro.pl) i praktyk agencji:
- Struktura blokowa: **naprzemienne bloki** nagłówek + akapit sprzedażowy + wypunktowanie korzyści (2-kolumnowe „karty" 1:1 obraz|tekst renderowane po stronie sklepu — my zapisujemy HTML z placeholderami `{{img1}}..{{imgN}}` które podmieniamy na zdjęcia produktu).
- Pierwszy blok = **hook** (największa korzyść, do kogo produkt), nie techniczna nazwa.
- Kolejne bloki: **Kluczowe cechy**, **Zastosowanie / dla kogo**, **Zawartość zestawu** (wypunktowanie), **Parametry techniczne** (lista klucz: wartość), **Najczęstsze pytania** (opcjonalnie 2–3 Q/A).
- Wypunktowania **korzyści-fokus** („co Ci to daje"), nie tylko cechy.
- Krótkie akapity (2–4 zdania), nagłówki `<h2>/<h3>`, bezpieczny whitelist HTML zgodny z Allegro (h1–h5, p, ul/ol/li, strong, em, br) — bez linków zewnętrznych, bez telefonów/e-maili, bez cen, bez nazw sklepów, bez CTA typu „kup teraz", bez porównań do konkurencji.
- Zgodność z **Regulaminem Allegro**: brak zakazanych zwrotów, brak informacji o dostawie/zwrocie/płatności w opisie, brak danych kontaktowych.
- Długość: 1500–3500 znaków tekstu widocznego.
- Język: PL, sprzedażowy, ale konkretny; fraza kluczowa w pierwszym bloku i w pierwszym `<h2>`.

## Zmiany w bazie
Migracja: dodać kolumnę `enrichments.allegro_description_html text` oraz `enrichments.allegro_generated_at timestamptz`. GRANTy jak reszta tabeli.
Do enuma `bulk_job_kind` dodać `PIM_ALLEGRO_DESCRIPTION`.

## Backend
1. **`src/lib/pim/seo.ts`** — dopisać `ALLEGRO_DESCRIPTION_SYSTEM_PROMPT` z powyższymi zasadami + funkcję `sanitizeAllegroDescriptionHtml` (whitelist tagów, wycinanie linków/telefonów/e-maili/cen, obsługa placeholderów `{{imgN}}`).
2. **`src/lib/pim/ai.functions.ts`** — nowa server-fn `generateAllegroDescription({ productId })`:
   - czyta produkt (golden name, description, features, images),
   - woła `openai/gpt-5.5` przez AI Gateway,
   - sanitizuje HTML, zapisuje do `enrichments.allegro_description_html`.
3. **`src/lib/pim/bulk-jobs.functions.ts`** — dołączyć `PIM_ALLEGRO_DESCRIPTION` do enum i `KindSchema`.
4. **`src/lib/pim/_workers.server.ts`** — dodać `runPimAllegroDescription(job)`: iteruje po `items` (produkty), wywołuje wspólną funkcję generatora, zapisuje postęp po każdym produkcie (bezpiecznie pod limit czasu Workera, tak jak wizualizacje).
5. **`src/routes/api/public/hooks/process-bulk-jobs.ts`** — dopiąć nowy kind do dispatchera.
6. **Export CSV** (`export.functions.ts`) — dodać kolumnę `allegro_description_html` do eksportu.

## UI
1. **Karta produktu** `src/routes/_auth/projects.$id.products.$pid.tsx`:
   - nowa sekcja **„Opis Allegro"** poniżej opisu SEO,
   - przycisk **„Generuj opis Allegro"** (loading + toast),
   - edytor HTML (textarea z podglądem, tak jak istniejący opis) + „Zapisz",
   - podgląd renderu (dangerouslySetInnerHTML w stylizowanym kontenerze, żeby pokazać jak wygląda blok).
2. **Lista projektu** `src/routes/_auth/projects.$id.index.tsx`:
   - w pasku akcji masowych dodać kafelek **„Opis Allegro"** (analogicznie do „Generuj złote rekordy"),
   - dialog z checkboxem „Nadpisz istniejące opisy Allegro" + wybór zakresu (wszystkie / zaznaczone / z filtrem),
   - odznaka statusu przy produktach z gotowym opisem (mała ikona „A").
3. **Podgląd karty produktu** `projects.$id.products.$pid_.preview.tsx` — dodać zakładkę **„Opis Allegro"** obok obecnego opisu, żeby klient live widział wynik.

## Szczegóły techniczne
- Wspólny helper `generateAllegroForProduct(supabase, product)` używany przez pojedynczy przycisk i workera — jedna prawda o formacie.
- Placeholder obrazów: prompt AI generuje `{{img1}}..{{imgN}}` (N = min(6, liczba zdjęć produktu). Sanitizer podmienia je na `<img src="…" alt="…"/>` przy zapisie oraz w podglądzie; w polu bazowym trzymamy wersję z placeholderami, żeby zdjęcie mogło się zmienić bez regeneracji tekstu.
- Prompt zawiera pełną listę zakazanych zwrotów Allegro (dane kontaktowe, dostawa, zwroty, linki zewnętrzne, ceny).
- Model: `openai/gpt-5.5` (chat default), `service_tier: "priority"` dla generacji pojedynczej z UI.

## Weryfikacja
- Wygeneruj opis dla 1 produktu z pełnym złotym rekordem — sprawdź strukturę bloków, brak zakazanych fraz, długość 1.5–3.5k znaków.
- Uruchom masowo dla 5 produktów — sprawdź, że job przechodzi przez timeouty (progresywny zapis), pojawia się odznaka na liście.
- Zweryfikuj eksport CSV — nowa kolumna zawiera HTML.
- Podgląd karty produktu pokazuje sekcję Allegro z podmienionymi obrazami.
