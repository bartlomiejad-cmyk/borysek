# Naprawa pozycji podglądu zdjęć na liście produktów

## Problem
Po najechaniu na miniaturę zdjęcia, powiększony podgląd pojawia się w niewłaściwym miejscu (środek panelu / góra strony) zamiast tuż obok miniatury — szczególnie po przewinięciu listy w dół.

## Przyczyna
Komponent `ImageStrip` w `src/routes/_auth/projects.$id.index.tsx` (linia ~1137) renderuje podgląd przez `position: fixed` ze współrzędnymi z `getBoundingClientRect()`. To powinno działać względem okna przeglądarki, ale któryś z przodków (animacja `animate-fade-in`, kontenery z `transform`/`filter`) tworzy własny kontekst pozycjonowania — wtedy `fixed` przestaje być względny do viewportu i element ucieka w bok.

## Rozwiązanie
Wyrenderować warstwę podglądu w portalu do `document.body` przez `createPortal` z `react-dom`. Wtedy żaden przodek z `transform` nie wpływa na pozycjonowanie, a obliczone współrzędne `clientX/clientY` zawsze pokrywają się z viewportem — podgląd pojawi się dokładnie obok miniatury, niezależnie od scrolla.

## Zmiany w kodzie

Plik: `src/routes/_auth/projects.$id.index.tsx`

1. Dodać import: `import { createPortal } from "react-dom";`
2. W komponencie `ImageStrip` zawinąć blok `{hovered ? (<div className="fixed …">…</div>) : null}` w `createPortal(…, document.body)`, z fallbackiem na SSR (`typeof document !== "undefined"`).

## Czego nie ruszam
- Logiki obliczania pozycji (`onMouseEnter`) — jest poprawna.
- Pozostałych funkcji (pin/hide/dialog).
- Backendu i jobów w tle.
