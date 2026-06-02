# Cel
W produktach nadal widać chrome sklepu (logo Blika, "zelewy24", ikona telefonu, banery „Bazant", „Gwarancja Najlepszej Ceny"), a w opisach `![Kontakt](...)`, „Zapytaj o produkt", numer telefonu. Te dane były zescrape'owane zanim wdrożyliśmy filtr AI — w bazie zostały. Plus sam filtr AI bywa zbyt zachowawczy.

# Rozwiązanie

## 1. Deterministyczne sito obrazów (zawsze)
Nowy plik `src/lib/pim/source-cleanup.ts` (czysty TS, bez `.server.ts` żeby był importowalny z obu stron):
- `isJunkImageUrl(url)` — odrzuca po nazwie pliku / ścieżce / rozszerzeniu:
  - metody płatności: `blik`, `paypal`, `visa`, `mastercard`, `przelewy24`, `p24`, `payu`, `bluemedia`, `dotpay`, `applepay`, `googlepay`, `zelewy`
  - chrome sklepu / certyfikaty: `gwarancj`, `najlepsza-cena`, `certyfikat`, `trustmark`, `opineo`, `ceneo-badge`, `ssl-`
  - kontakt / social: `kontakt`, `phone`, `tel-`, `envelope`, `facebook`, `instagram`, `youtube`, `tiktok`, `whatsapp`
  - chrome UI: `logo`, `banner`, `header`, `footer`, `icon-`, `sprite`, `placeholder`
  - formaty: `.svg`, `.gif`
  - miniaturki: `_xs`, `_sm`, `mini`, `=s48`, `=w64`
- `filterImageUrls(urls)` — wrapper z dedup
- `sanitizeProductDescription(md)` — wycina linie markdown z chrome'owymi obrazami, frazy stopkowe („Zapytaj o produkt", „Udostępnij", „Newsletter", „Gwarancja bezpiecznego zakupu", „Dostawa", „Płatność", „Zwroty"), telefon/email, odcina od pierwszej sekcji typu „Polecane / Zobacz też / Opinie / Kontakt / Regulamin", przycina do ~3000 znaków.

## 2. Użycie w pipeline scrape'u
W `src/lib/pim/_workers.server.ts`:
- `pickImagesFromScrape` — po zebraniu kandydatów: `filterImageUrls(out).slice(0, 12)` (mniej szumu trafia do AI).
- `runFirecrawlDiscovery` — po `filterScrapedForProduct` jeszcze raz `filterImageUrls` na wyniku AI jako bezpiecznik; `description = sanitizeProductDescription(filteredData.description)`.
- `collectScrapedUrls` (galeria do FAL/regen) — `filterImageUrls` na wczytanych z bazy zdjęciach, więc nawet bez re‑scrape'u stare śmieci nie pójdą do galerii.

## 3. Wzmocniony prompt AI filtru
W `filterScrapedForProduct` rozszerzenie listy POMIŃ o konkretne kategorie: „logo Blik / Visa / Mastercard / Przelewy24 / PayU / DotPay / BlueMedia", „logo sklepu i certyfikaty (Bazant, Gwarancja Najlepszej Ceny, SSL)", „ikona telefonu / koperty / social media", „przyciski 'Zapytaj o produkt' / 'Udostępnij'", „informacje o dostawie, płatnościach, gwarancji bezpiecznego zakupu, numery telefonu i e‑maile sklepu". Max ~3000 znaków w opisie.

## 4. Reklean istniejących źródeł (bez re‑scrape'u, bez kosztu Firecrawl)
Nowa server function w `src/lib/pim/firecrawl.functions.ts`:
- `recleanProductSources({ projectId })` z `requireSupabaseAuth`, walidacja Zod.
- Pobiera wszystkie `product_sources` projektu (ownership via RLS).
- Dla każdego wiersza: `images = filterImageUrls(images)`, `description = sanitizeProductDescription(description)`.
- `update` tylko gdy coś faktycznie się zmieniło.
- Zwraca `{ scanned, updated, imagesRemoved, charsRemoved }`.

## 5. UI — przycisk „Wyczyść źródła"
W `src/routes/_auth/projects.$id.index.tsx`, w pasku akcji obok „Wyszukaj źródła (Firecrawl)":
- `Button variant="outline"` → wywołanie `recleanProductSources`.
- Po sukcesie toast ze statystykami, `invalidateQueries` na listę produktów / źródeł.
- Bez confirm dialogu (operacja bezpieczna i odwracalna przez re‑scrape).

# Pliki
- `src/lib/pim/source-cleanup.ts` (nowy, czysty TS)
- `src/lib/pim/_workers.server.ts` (użycie helperów + wzmocniony prompt)
- `src/lib/pim/firecrawl.functions.ts` (nowa `recleanProductSources`)
- `src/routes/_auth/projects.$id.index.tsx` (przycisk + handler)

# Bez migracji DB
Pracujemy na istniejących polach `product_sources.images` i `description`.

# Po wdrożeniu
Klikasz „Wyczyść źródła" w widoku projektu — Blik, Bazant, kontakt i stopkowe frazy znikają natychmiast z prawego panelu w widoku weryfikacyjnym. Bez Publish, bez kosztu Firecrawl.
