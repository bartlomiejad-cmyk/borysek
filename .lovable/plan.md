## Cel
Zwiększyć skuteczność importu z linków dla stron chronionych anty-botem (reCAPTCHA, Cloudflare, Datadome), tak jak mieloch.pl, przez wymuszenie renderowania w przeglądarce po stronie Firecrawl zamiast prostego pobrania HTML.

## Diagnoza
Obecnie `src/lib/pim/import-urls.functions.ts` woła Firecrawl w trybie zwykłego scrape'a. Strony za challenge'em (Cloudflare/reCAPTCHA) zwracają wtedy stronę interstitial zamiast produktu — stąd fallback łapał `reCAPTCHA` jako `<h1>`.

Firecrawl v2 udostępnia mechanizmy, które w większości przypadków rozwiązują problem bez uciekania się do szarej strefy:
- `formats: ['markdown','html']` + `onlyMainContent: true` (już mamy)
- `waitFor` — czekanie aż JS zdąży się wykonać po challenge'u
- `mobile: true` / rotacja User-Agenta — mniej stron wymaga wtedy challenge'u
- `location: { country, languages }` — geo dopasowane do sklepu (PL)
- `proxy: 'stealth'` (nowość v2) — rezydencjalne proxy + stealth browser, dedykowane do stron z anty-botem
- `actions: [{ type: 'wait', milliseconds }, { type: 'screenshot' }]` — pozwala poczekać na Cloudflare turnstile i zweryfikować

## Zakres zmian

### 1. `src/lib/pim/import-urls.functions.ts`
- Pierwsza próba scrape'a bez zmian (tanio).
- Jeśli wynik przechodzi przez `looksLikeChallengePage` LUB `isJunkName` LUB brak treści produktowej → automatyczny retry z „trybem stealth":
  - `proxy: 'stealth'`
  - `waitFor: 4000`
  - `location: { country: 'PL', languages: ['pl'] }`
  - `mobile: true` (rotacyjnie na drugiej próbie)
- Dopiero po drugiej nieudanej próbie zwracamy błąd „Nie udało się przejść przez zabezpieczenie anty-botowe strony" z sugestią wklejenia treści ręcznie.
- Loguj do konsoli serwera (`console.warn`) info, że włączono stealth — do diagnostyki bez ujawniania kluczy.

### 2. UI — `src/components/pim/ImportUrlsDialog.tsx`
- Dodaj opcjonalny checkbox **„Tryb stealth (wolniejszy, dla stron z Cloudflare/reCAPTCHA)"**, który wymusza od razu drugą ścieżkę i zwiększa timeout klienta.
- Komunikat błędu z serwera pokazany 1:1 w dialogu (już jest, ale wzbogacony o podpowiedź).

### 3. Fallback ręczny (opcjonalny, do decyzji)
Gdy nawet stealth zawiedzie — pole tekstowe w dialogu do wklejenia HTML/tekstu produktu, który idzie do tej samej pipeline'y AI extract co dziś. To eliminuje twarde blokady bez łamania regulaminów sklepów.

## Czego świadomie NIE robimy
- Nie omijamy CAPTCHA przez zewnętrzne solvery (2Captcha itp.) — narusza to regulaminy większości sklepów i jest kruche.
- Nie stawiamy własnego headless-browsera w Workerze — nie zmieści się w limitach runtime'u (patrz `server-runtime`).
- Nie zmieniamy nagłówków HTTP „na siłę" po naszej stronie — Firecrawl robi to lepiej i legalnie w swojej infrastrukturze.

## Detale techniczne
- Firecrawl v2 `scrape` przyjmuje `proxy: 'basic' | 'stealth' | 'auto'`. Stealth kosztuje więcej kredytów per request, więc używamy go tylko jako fallback.
- Kolejność prób: `basic` (domyślne) → `stealth + waitFor 4s + PL geo` → błąd.
- `import-urls.functions.ts` już centralizuje wywołanie Firecrawl — zmiana lokalna, bez ruszania `_workers.server.ts` i głównego Discovery.

## Test manualny (po wdrożeniu)
1. Import `https://mieloch.pl/wydech-yasuni-carrera-16-aluminium-red-gilera-piaggio` → powinien wpaść w stealth i wrócić z nazwą „Wydech Yasuni Carrera 16 …".
2. Import losowej strony bez ochrony → dalej idzie tanią ścieżką (1 kredyt).
3. Strona z twardym CAPTCHA → czytelny błąd + podpowiedź o ręcznym wklejeniu.
