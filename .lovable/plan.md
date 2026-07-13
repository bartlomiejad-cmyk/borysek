## Problem

Import URL zaciągnął produkt o nazwie „reCAPTCHA". Firecrawl scrape zwrócił stronę zabezpieczeń antybotową (reCAPTCHA/Cloudflare/„Just a moment…"), a fallback `extractH1` wziął pierwszy `<h1>` z takiej strony jako nazwę produktu.

## Rozwiązanie — `src/lib/pim/import-urls.functions.ts`

### 1. Wykrywanie stron-blokad przed jakąkolwiek ekstrakcją
Dodaj helper `looksLikeChallengePage(rawHtml, markdown, title)` który zwraca `true`, gdy w HTML/markdown/title pojawia się dowolny z markerów:
- `recaptcha`, `g-recaptcha`, `hcaptcha`, `cf-challenge`, `cf-browser-verification`, `cloudflare`
- `just a moment`, `checking your browser`, `attention required`, `access denied`, `403 forbidden`, `robot check`

Jeżeli trafienie → zwróć od razu `{ url, ok: false, error: "Strona zablokowana przez zabezpieczenia antybotowe (reCAPTCHA/Cloudflare). Spróbuj innego linku lub uruchom import ponownie." }`.

### 2. Blocklist na wynikową nazwę (belt-and-suspenders)
Nawet gdy challenge nie zostanie wykryty przez markery, po wybraniu `rawNazwa` zwaliduj:
```
const JUNK_NAMES = ["recaptcha", "captcha", "cloudflare", "just a moment",
  "attention required", "access denied", "403 forbidden", "not found",
  "robot check", "verify you are human"];
```
Jeżeli znormalizowana `rawNazwa` (lowercase, trim) zawiera któryś marker lub jest krótsza niż 3 znaki → traktuj jako brak nazwy i zwróć czytelny błąd.

### 3. Wybór lepszego `<h1>` gdy jest ich kilka
Zmień `extractH1` na `extractProductH1(rawHtml)`:
- Zbierz WSZYSTKIE `<h1>` z HTML.
- Preferuj ten z klasą zawierającą `product`, `product-name`, `product-title`, `item-title` (case-insensitive) — mieloch.pl używa `<h1 class="product-name">`.
- W przeciwnym razie zwróć pierwszy `<h1>` który nie pasuje do `JUNK_NAMES`.

To samo zastosuj do `extractHtmlTitle` — po strip odrzuć wynik pasujący do JUNK_NAMES.

### 4. Bez zmian w schemacie/DB/UI
Zmiana wyłącznie w `src/lib/pim/import-urls.functions.ts`. UI dialogu pokaże czytelny komunikat błędu z pkt. 1/2, użytkownik zobaczy dlaczego link został odrzucony.

## Uwagi

- Rekord „reCAPTCHA" widoczny w projekcie mieloch.pl trzeba usunąć ręcznie z listy produktów po wdrożeniu — poprawka nie robi żadnej retroaktywnej wstecznej korekty w bazie.
- Nie próbujemy obchodzić reCAPTCHA — po prostu rzetelnie zgłaszamy błąd zamiast tworzyć „śmieciowy" produkt.
