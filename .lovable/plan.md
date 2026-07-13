## Problem

Import URL `https://mieloch.pl/wydech-yasuni-carrera-16-aluminium-red-gilera-piaggio` kończy się błędem „Nie udało się wykryć nazwy produktu". Strona nie ma `application/ld+json` typu Product, więc `hints.name` jest puste; Firecrawl scrape z `onlyMainContent: true` obcina wiele nagłówków, przez co AI zwraca `nazwa: ""`; `metadata.title` w SDK v2 bywa pod inną kluczem (`ogTitle`, `og:title`) — łańcuch fallbacków (AI → JSON-LD → pageTitle) upada.

## Rozwiązanie — `src/lib/pim/import-urls.functions.ts`

### 1. Zażądaj dodatkowo pełnego HTML i nie odcinaj chrome przy pierwszym scrape
Zmień wywołanie Firecrawl na dwa formaty: pobierz `rawHtml` bez `onlyMainContent` (żeby mieć `<h1>` i `<title>`), a `markdown` z `onlyMainContent: true` (do AI). Jeżeli SDK nie pozwala mieszać, wykonaj scrape raz z `onlyMainContent: true` i osobno wyciągnij `<h1>` / `<title>` / `og:title` z `rawHtml`, który Firecrawl zwraca w pełnej formie niezależnie od `onlyMainContent`.

### 2. Rozszerz zbieranie tytułu strony (`pageTitle`)
Zamień jednolinijkowe:
```
const pageTitle = (meta.title ?? meta.ogTitle) as string | undefined ?? null;
```
na helper, który po kolei sprawdza: `meta.title`, `meta.ogTitle`, `meta["og:title"]`, `meta.twitterTitle`, `meta["twitter:title"]`, a jeśli wszystko puste — wyciąga `<title>…</title>` regexem z `rawHtml`.

### 3. Dodaj czwarty fallback: `<h1>` z surowego HTML
Nowy helper `extractH1(rawHtml)` — regex `/<h1\b[^>]*>([\s\S]*?)<\/h1>/i` z usunięciem tagów wewnętrznych i normalizacją whitespace'ów. Uruchamiany tylko gdy AI/JSON-LD/tytuł nie dały nazwy.

### 4. Zaktualizuj kolejność fallbacków przy `rawNazwa`
```
extracted.nazwa || hints.name || pageTitle || extractH1(rawHtml) || ""
```

### 5. Lepszy komunikat błędu
Zamiast ogólnego „Nie udało się wykryć nazwy produktu" pokaż użytkownikowi krótki hint zależny od tego, co zawiodło (np. „Strona nie zawiera nagłówka H1/tytułu — sprawdź czy link prowadzi do konkretnego produktu, nie do listingu"). Nie zmieniamy typu zwrotu — tylko treść `error` w `ExtractResult`.

## Uwagi

- Zmiana wyłącznie w `src/lib/pim/import-urls.functions.ts`. Nie ruszamy schematu bazy, workerów, ani UI dialogu.
- Po naprawie link mieloch.pl powinien się zaimportować z nazwą z `<h1>` (`Wydech Yasuni Carrera 16 Aluminium Red, Gilera / Piaggio`), następnie wzbogaconą o markę (Yasuni) i MPN jeżeli AI je wyciągnie.
