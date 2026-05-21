# Pomelli redesign — przebudowa układu (nie tylko kolory)

Cel: oddać DNA narzędzia Pomelli — duża pastylkowa nawigacja boczna z markowanym logo, ciemna oliwka jako tło, kremowy serif w nagłówkach typu "display", soft-pill przyciski w pastelowej szałwii, miękkie karty z mocnym `rounded-3xl`, lekkie floatowanie i wejścia `fade/scale`. Dziś zmieniliśmy tylko tokeny — teraz rozbijamy układ.

## Co dokładnie się zmienia

### 1. Nowa powłoka aplikacji — `src/routes/_auth.tsx`
Zamiast wąskiego topbara wprowadzamy **lewy sidebar w stylu Pomelli**:
- Szerokość 260 px, tło lekko jaśniejsze od `--background` (`bg-card/50`), brak twardej kreski — separacja przez `backdrop-blur` i delikatny `border-r`.
- Górą: logo (mała kolorowa "kolba" w pastelowej pastylce) + napis serifem **"AI Enricher"** + chip `EXPERIMENT`.
- Linki nawigacyjne renderowane jako **pełnozaokrąglone "pillsy"** (`rounded-2xl`, h-11, ikona + label). Aktywny: `bg-primary text-primary-foreground`, nieaktywny: hover `bg-muted/60`. Pozycje: **Projekty**, **Bieżący projekt** (jeśli jesteśmy w `/projects/$id`), **Weryfikacja**, **Eksport**.
- Stopka sidebara: avatar (kółko z inicjałem maila w pastelowym kolorze) + wyciszony tekst maila + ikonka wylogowania jako mały `rounded-full ghost`.
- Główna część `min-h-screen` z paddingiem, `<Outlet/>` opakowany w `animate-fade-in`.
- Responsywnie: poniżej `md` sidebar zwija się w `Sheet` (shadcn) otwierany przyciskiem hamburger w lekkim sticky topbarze.

### 2. Nagłówki sekcji jako serif display
Wprowadzamy mały helper-component `PageHeader` (inline, w `_auth.tsx` lub w `src/components/ui/page-header.tsx`):
- `h1` `font-serif text-4xl md:text-5xl` + opcjonalny lead `text-muted-foreground`.
- Używany w `projects.index.tsx`, `projects.$id.index.tsx`, `projects.$id.verify.tsx`, `projects.$id.products.$pid.tsx` — zamienia istniejące `text-3xl font-bold`.

### 3. Globalne dopalenie komponentów (bez logiki)
W już istniejących plikach **tylko klasy Tailwind**:
- `Card` → dodajemy `rounded-3xl border-border/60` ad-hoc tam, gdzie są używane (pozostają semantyczne tokeny).
- `Button` (instancje primary CTA) → klasa `rounded-full px-6` żeby uzyskać pomelliowy pill (np. "Wygeneruj brief", "Stwórz", "Eksportuj").
- Główne CTA z ikoną `Sparkles` dostają wariant `bg-primary text-primary-foreground rounded-full` z `Sparkles` po lewej.
- `Input`/`Textarea` w głównych formularzach → `rounded-2xl bg-muted/50 border-border/60 h-12`.
- Sekcje stron startują z `className="animate-fade-in"`, karty kafelkowe dostają `hover-lift`.

### 4. Strona "Projekty" (`projects.index.tsx`)
- Hero u góry: serifowy nagłówek "Twoje projekty" + lead.
- "Nowy projekt" zamieniamy z karty na **pojedynczy pasek wyszukiwarko-podobny** (duży `rounded-3xl` kontener z `Input` po lewej i pill CTA "Stwórz" po prawej, w środku wyciszony placeholder w stylu Pomelli "Describe…"). To bezpośrednia kalka pomelliowego prompt-baru.
- Lista projektów: grid kart `rounded-3xl` z `hover-lift`, miniaturowy "kolorowy znaczek" w rogu (kółko w `--accent` lub `--primary`).

### 5. Strona projektu (`projects.$id.index.tsx`) i karta produktu (`projects.$id.products.$pid.tsx`)
- Nagłówki sekcji `PageHeader` w serifie.
- Główne CTA jako pillsy (Generuj brief, Eksportuj, Uruchom matching itp.).
- Karty z `rounded-3xl`, sekcje z `animate-fade-in`, miniatury produktów `rounded-2xl` z `hover-lift` (bez zmian logiki). Bez przebudowy treści — tylko klasy.

### 6. Tła i akcenty
- Body utrzymuje ciemną oliwkę.
- Dodajemy w `_auth.tsx` subtelną dekorację: za sidebarem `bg-gradient-to-b from-card/30 to-transparent`, w prawej kolumnie u góry stronnicowy `radial-gradient` w `--primary/10` (czysty CSS, jeden absolutny `div pointer-events-none`).

### 7. Brak nowych zależności, brak zmian logiki
- Sidebar i sheet z shadcn (już są w projekcie).
- Żadnych zmian w `src/lib/pim/*`, server functions, schemacie DB ani zapytaniach.
- `routeTree.gen.ts` nietykany.

## Pliki do edycji
- `src/routes/_auth.tsx` — całkowita przebudowa layoutu (sidebar + topbar mobile).
- `src/routes/_auth/projects.index.tsx` — hero + prompt-bar + grid pillowych kart.
- `src/routes/_auth/projects.$id.index.tsx` — `PageHeader`, pillowe CTA, klasy `rounded-3xl`.
- `src/routes/_auth/projects.$id.products.$pid.tsx` — `PageHeader`, pillowe CTA, klasy.
- `src/routes/_auth/projects.$id.verify.tsx` — `PageHeader`, pillowe CTA, klasy.
- (opcjonalnie) `src/components/ui/page-header.tsx` — mały komponent prezentacyjny.

## Czego NIE robimy
- Nie przepisujemy logiki, query, mutacji, AI promptów ani server functions.
- Nie wprowadzamy własnych palet poza już zdefiniowanymi tokenami Pomelli z `src/styles.css`.
- Nie wymuszamy zmiany struktury danych ani routingu.
