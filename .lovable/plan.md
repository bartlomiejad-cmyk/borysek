# Fix: martwe zdjęcia nie znikają po ponownej weryfikacji

## Diagnoza

`revalidateImages` w `src/routes/_auth/projects.$id.products.$pid.tsx` wywołuje `analyzeProductImages` z `urls: allVisible.slice(0, 8)` (a server-fn dodatkowo ma walidator `.max(8)`). W widoku produktu jest 16 zdjęć — te uszkodzone są dalej w liście (pozycje 9–16), więc `filterAliveImages` nigdy ich nie probuje i nie ustawia `dead:true`. W efekcie po kliknięciu przycisku:
- top 8 zdjęć: identity re-scoring działa, ale one nie były martwe,
- dalsze 8 (te faktycznie zbite): nie są sondowane wcale → nadal widoczne z pustą miniaturką.

Dodatkowo `runPimImageVerify` (używany w Weryfikacji zbiorczej) filtruje `toScore` przez `needsCheck` (`identity_v` cache), więc dla obrazów już zescore'owanych też pomija HEAD-probe — ten sam problem w drugim wariancie.

## Zmiany

1. **Rozbić re-weryfikację na dwa kroki po stronie serwera.**  
   W `src/lib/pim/ai.functions.ts` dodać osobną, tanią server-fn `probeVisibleImagesAlive({ productId })`:
   - Pobiera enrichment + wszystkie `product_sources.images / extra_images` dla `picked_urls`.
   - Wyklucza `hidden_images` i (w compatible mode) obrazy z nie-primary źródeł.
   - Wywołuje `filterAliveImages` na CAŁYM zbiorze URL-i (bez limitu 8), z `revalidate` semantyką: URL-e oznaczone wcześniej `dead:true` są ponownie sondowane; `manual_keep` nietykalne.
   - Zwraca `{ alive, dead }` i zapisuje merged `image_scores` (już to robi `filterAliveImages`).
   - Server-fn autoryzowana przez `requireSupabaseAuth`.

2. **Front-end: `revalidateImages`** wywołuje najpierw `probeVisibleImagesAlive({ productId: pid })`, a dopiero potem `analyzeProductImages` na `alive.slice(0, 8)` (identity re-scoring pozostaje z limitem 8, bo używa Vision — to droga część). Po obu krokach `invalidate()`.

3. **`runPimImageVerify` (bulk „Zweryfikuj zdjęcia")** — przenieść `filterAliveImages` PRZED filtrem `needsCheck`, żeby HEAD-probe zawsze objął pełen `uniq`. `needsCheck` decyduje tylko o AI identity, nie o probingu.

4. **UI**: bez zmian wizualnych. Toast pokazuje `Zweryfikowano N zdjęć · X martwych` gdy `dead.length > 0`, żeby użytkownik widział że sekcja „Niedostępne" powinna urosnąć.

## Weryfikacja

Na tym produkcie: klik „Zweryfikuj zdjęcia ponownie" → 8 pustych kafelków przechodzi do sekcji „Niedostępne", licznik „widocznych" spada, żywe zdjęcia zostają. Powtórny klik nie zmienia stanu (dead cache).
