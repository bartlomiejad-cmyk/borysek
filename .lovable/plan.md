# Restyling w duchu Google Pomelli

Cel: nadać całej aplikacji spójną estetykę inspirowaną Google Pomelli — ciemne, ciepłe tło oliwkowo-zielone, kremowa typografia serif w nagłówkach, miękkie pastele jako akcenty, mocno zaokrąglone rogi i delikatne animacje (fade, scale, floating).

## Kierunek wizualny

- **Tło**: głęboka oliwka / ciemny mech (np. `oklch(0.22 0.04 130)`).
- **Tekst**: kremowy off-white (`oklch(0.94 0.02 90)`), wyciszony muted (`oklch(0.75 0.02 90)`).
- **Akcent primary**: pastelowa szałwia / limonka (przycisk "Let's get started"), `oklch(0.86 0.12 130)` z ciemnym foreground.
- **Akcenty drugorzędne**: ciepły terakota / brzoskwinia i pyłkowy róż jako wykończenia (badge, hover, ikony).
- **Karty/inputy**: ciemniejsza powierzchnia (`oklch(0.27 0.03 130)`), border bardzo subtelny (`oklch(1 0 0 / 8%)`).
- **Radius**: bazowy `1.25rem` (czyli karty ~`rounded-3xl`, przyciski pełne `rounded-full`, miniatury `rounded-2xl`).
- **Typografia**: nagłówki — serif w stylu Ivypresto (Google Font: **Instrument Serif** lub **Cormorant Garamond**); body — humanistyczny sans (**Inter** / **DM Sans**).
- **Animacje**: `fade-in` i `scale-in` przy wejściu sekcji, lekkie `hover-scale` na miniaturach, floating (subtelne `translateY`) na pływających elementach, smooth transition 200–300 ms na wszystkim co interaktywne.

## Zakres zmian (wyłącznie warstwa prezentacji)

1. **`src/styles.css`** — przepisanie tokenów: `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--accent`, `--muted`, `--border`, `--ring` na paletę Pomelli (w `oklch`). Zwiększenie `--radius` do `1.25rem`. Dodanie keyframes `float`, `fade-in`, `scale-in` oraz utilities `.animate-float`, `.hover-lift`. Import Google Fonts (Instrument Serif + Inter) przez `@import` w `styles.css`. Domyślnie aplikacja w trybie ciemnym (`.dark` na `<html>`).
2. **`src/routes/__root.tsx`** — dodanie klasy `dark` na `<html>` żeby ciemny motyw był domyślny; ewentualny `font-serif` na nagłówkach przez globalny CSS.
3. **Komponenty wysokopoziomowe** (bez zmian logiki):
   - `src/routes/index.tsx`, `src/routes/login.tsx` — nagłówki w serifie, CTA jako `rounded-full`.
   - `src/routes/_auth.tsx` (nav) — wyciszone tło, pill-style linki, hover z miękkim accentem.
   - `src/routes/_auth/projects.index.tsx`, `projects.$id.index.tsx`, `projects.$id.products.$pid.tsx`, `projects.$id.verify.tsx` — karty z `rounded-3xl`, miniatury `rounded-2xl`, sekcje z `animate-fade-in`, badge'y w pastelach.
   - `src/components/pim/UploadZone.tsx` — dropzone z grubo zaokrąglonym dashed borderem i delikatną animacją hover.
4. **shadcn UI** — bez modyfikacji plików (variant button itd. respektują tokeny). Zmiana wyglądu pochodzi w 100% z `styles.css`.

## Czego NIE ruszamy

- Żadnej logiki serwerowej, query, mutacji, walidacji, AI ani schematu DB.
- Żadnych zmian w `src/integrations/supabase/*`, `src/lib/pim/*`, `routeTree.gen.ts`.
- Brak nowych zależności npm (fonty przez Google Fonts CSS import).

## Tryb jasny

Pomelli to dark-first. Zostawiamy zdefiniowane sensowne wartości `:root` (jasny wariant w tej samej rodzinie — kremowe tło, oliwkowy tekst), ale aplikacja startuje w `.dark`.
