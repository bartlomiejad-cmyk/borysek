## Co się stało

Job `FIRECRAWL_DISCOVERY` (632 produkty) zakończył się z `failed_count = 632`, a `last_error = "Skonfiguruj Komponent A w ustawieniach AI"`. To komunikat z `runRegenerateMedia` — czyli każdy produkt został przepuszczony przez worker regeneracji zdjęć, nie przez Firecrawl.

Przyczyna: `pg_cron` co minutę woła **opublikowany** URL:

```
https://project--a56746f2-6fdf-47b1-8095-043a41af98fd.lovable.app/api/public/hooks/process-bulk-jobs
```

Opublikowana wersja appki jest sprzed dodania Firecrawla. W jej `processItem` gałąź `else` (czyli każdy nieznany `kind`, w tym `FIRECRAWL_DISCOVERY`) prowadziła do `runRegenerateMedia`. Stąd seryjny błąd o Komponencie A — nic wspólnego z Firecrawlem ani z samymi produktami.

W preview (najnowszy kod) wszystko jest poprawnie podpięte: `processItem` ma osobną gałąź `FIRECRAWL_DISCOVERY → runFirecrawlDiscovery`, worker zapisuje do `search_results` / `product_sources`.

## Plan naprawy

1. **Opublikować projekt** (Publish) — to wgra na `*.lovable.app` aktualnego workera z obsługą `FIRECRAWL_DISCOVERY`. Bez tego kroku cron nadal będzie marszczył failowane joby, niezależnie od zmian w kodzie.
2. **Wyczyścić feralny job** (`9bb8c4f9-…`) — ustawić go na `CANCELLED` żeby nie mylił UI / historii.
3. **Zabezpieczyć przed nieznanym `kind`** w `src/routes/api/public/hooks/process-bulk-jobs.ts`: zamiast `else { runFirecrawlDiscovery }` użyć jawnego `switch` i dla nieznanego typu rzucać `Error("Unknown job kind: …")`. Dzięki temu w przyszłości żaden nowy typ zadania nie trafi przypadkiem do złego workera — job się zatrzyma z jasnym komunikatem, zamiast zepsuć 600 rekordów.
4. **Po publikacji** uruchomić „Wyszukaj źródła (Firecrawl)" raz na małej próbce (np. 5 produktów), zweryfikować w `search_results` i `product_sources`, że wpisy się pojawiają, dopiero potem puścić cały zestaw.

## Pliki do zmiany

- `src/routes/api/public/hooks/process-bulk-jobs.ts` — twardy `switch` po `kind`.
- Migracja jednorazowa (UPDATE) — oznaczyć stary job jako CANCELLED (`processed_count = 0`, `failed_count = 632`, zostawić `last_error` do audytu).

Akcja po Twojej stronie: kliknij **Publish** zaraz po zatwierdzeniu planu — bez tego cron dalej będzie używał starego kodu.