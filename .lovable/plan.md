## Cel

Naprawić zaśmiecony opis produktu (przykład: strona `stephenandson-gunmakers.co.uk` — do bazy trafiła sekcja "Shipping / Reviews / SKU / £ / RFD / Adding to cart" zamiast właściwego opisu). Trzy warstwy poprawek: (1) sanityzacja markdownu wyciąga tylko sekcję `## Description`, (2) rozszerzone regexy tną chrome sklepów po angielsku, (3) prompt AI-filtra jawnie odrzuca chrome i tłumaczy opis EN→PL.

## Zmiany

### 1. `src/lib/pim/source-cleanup.ts`

- **Dodać `extractDescriptionSection(md: string): string | null`**: jeżeli w markdown jest nagłówek `## Description`, `# Description`, `## Opis`, `## Product description`, `## Product Details`, `## Details`, `## Specification` (case-insensitive, dopuszcza `**`, dwukropki) — zwraca treść tej sekcji do najbliższego kolejnego nagłówka `#`/`##` lub do końca dokumentu; w przeciwnym razie `null`. Pomijamy sekcje-śmieci: `Reviews`, `Shipping`, `Delivery`, `Returns`, `Payment`, `Warranty`, `About us`, `Contact`, `FAQ`, `Related`, `You may also like`.
- **Rozszerzyć `DESC_BLOCK_PHRASES`** o angielskie chrome:
  - `was:\s*$`, `now:\s*$`, `you save`, `nan% on this product`, `sku:`, `upc:`, `current stock:`, `decrease quantity`, `increase quantity`, `adding to cart`, `the item has been added`, `stock coming soon`, `out of stock`, `email\s+when\s+available`,
  - `uk shipping`, `standard delivery`, `click\s*&\s*collect`, `photo id`, `restricted products?`, `ship to local rfd`, `local rfd`, `international shipping`, `import duties?`, `customs (policies|clearance|authorities|office)`, `shipping quote`, `bank holidays?`, `postal strikes?`, `remote postcodes?`,
  - `exchanges? & refunds?`, `refund policy`, `return form`, `original (product )?packaging`, `product labels attached`, `28 days of purchase`, `package up the items`,
  - ceny walutowe stojące same w linii: `^\s*[£€$]\s*\d`, `^\s*\d+([.,]\d+)?\s*(gbp|eur|usd|pln|zł)\s*$`,
  - separatory `* * *` / `---` / `___` w osobnej linii (usuwać).
- **Zmienić `sanitizeProductDescription`**: na wejściu najpierw spróbuj `extractDescriptionSection`; jeżeli znalazło — pracuj TYLKO na tym fragmencie (zamiast całego markdown). Jeżeli po całym pipelinie zostaje < 40 znaków tekstu (po odjęciu białych znaków) — nie zmieniam, zostawiam (nie wpisuję fallbacku).
- **Dodać `looksLikeEnglish(text: string): boolean`** (proste heurystyki: częstość słów `the/of/and/is/for/with` vs. brak polskich diakrytyków) — potrzebne dla promptu w kroku 3.

### 2. `src/lib/pim/_workers.server.ts` — funkcja `filterScrapedForProduct`

- **Prompt (system)**: rozszerzyć listę „POMIŃ BEZWZGLĘDNIE" o angielskie odpowiedniki:
  - "SKU / UPC / Current Stock / Adding to cart / Out of stock / Email when available / Was / Now / You save / NaN%"
  - "UK Shipping / Standard Delivery / Click & Collect / Photo ID / Restricted products / Ship to Local RFD / International Shipping / import duties / customs / Bank holidays / postal strikes / remote postcodes"
  - "Exchanges & Refunds / Return Form / 28 days of purchase / original packaging"
  - "sekcje '## Reviews', '## Shipping', '## Delivery', '## Returns', '## Payment', '## Warranty', '## Related', '## You may also like'"
  - "ceny w GBP/EUR/USD/PLN, separatory `* * *` / `---`"
- **Prompt (tłumaczenie)**: dodać regułę: „Jeżeli źródłowy opis jest po angielsku (lub w innym języku niż polski), PRZETŁUMACZ `product_description` na naturalny język polski, zachowując dosłownie: nazwę produktu, marki, model, wariant, gramaturę, kaliber, jednostki i inne dane techniczne. Cechy w `product_features` — klucze po polsku (np. Kaliber, Masa pocisku, Typ pocisku), wartości mogą pozostać w oryginale gdy to nazwy własne."
- **Preprocessing markdown przed wysłaniem do AI**: przed `pageMarkdown.slice(0, 3500)` przepuścić przez nowy `extractDescriptionSection(pageMarkdown) ?? pageMarkdown` — AI dostaje już przyciętą sekcję zamiast całej strony. To główny lifting; sam prompt nie wystarczy, gdy w 3500 znaków wchodzi głównie polityka wysyłki.

### 3. Weryfikacja

- Ręcznie przeklejam markdown z podanego URL (`stephenandson-gunmakers.co.uk/norma-223-rem-v-max-3-2g-50gr/`) do skryptu jednorazowego (dev-console) i sprawdzam:
  - `extractDescriptionSection` zwraca jedną linię `Norma .223 Rem V Max 3,2g/50gr` (bo taka jest sekcja Description),
  - `sanitizeProductDescription` na całym markdown daje pusty/bardzo krótki wynik (bo cała reszta to chrome),
  - po ponownym Firecrawlu (`Uzupełnij zdjęcia` → tylko scrape) na produkcie Norma opis zapisany w `product_sources.description` jest krótki i po polsku (lub pusty, jeśli źródło nie ma opisu). Generator `golden_description` uzupełni resztę na podstawie nazwy + cech.

### Poza zakresem

- Layout dialogu importu / mapowania (bez zmian).
- Regeneracja mediów, prompty FAL — bez zmian.
- Języki inne niż PL/EN — regex EN wystarczy dla obecnych źródeł.
- Brak zmian w schemacie DB.

## Techniczne detale (dla dewelopera)

- `extractDescriptionSection` musi być tolerancyjny na: `## Description`, `**Description**`, `Description\n===`, wielkość liter i trailing `:` — użyć regex `/^\s{0,3}(#{1,6}\s+|\*\*\s*)?(product\s+)?(description|opis|product details|specification|specyfikacja)\s*[:\s\*]{0,4}$/im` do znalezienia startu, i podobnego dla końca sekcji.
- `looksLikeEnglish` używane tylko jako sanity-log; samo tłumaczenie realizuje LLM w prompt-cie.
- Filter `AI_FILTER_MODEL` (`google/gemini-2.5-flash`) obsługuje tłumaczenie w tym samym wywołaniu — nie dodajemy drugiego przelotu.
- Wszystkie zmiany są odwracalne per-produkt: użytkownik uruchamia `Wyszukaj źródła (Firecrawl)` ponownie na wybranych produktach, `product_sources` nadpisuje się.
