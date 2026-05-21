# Sticky sidebar + zwijane źródła

## 1. Sidebar zawsze widoczny (`src/routes/_auth.tsx`)

Obecny `sticky top-0 h-screen` nie działa, bo nadrzędny kontener ma `overflow-hidden`, co łamie sticky positioning — sidebar przewija się razem z treścią i kończy w połowie strony (orange box na screenie).

Naprawa:
- Sidebar desktop → `fixed left-0 top-0 h-screen w-[260px]` (zamiast sticky).
- Główna kolumna → dodajemy `md:ml-[260px]` żeby treść nie wchodziła pod sidebar.
- Z outer wrappera usuwamy `overflow-hidden` (dekoracyjne blur-y już są w środku flexa i mają `pointer-events-none`).

Efekt: sidebar zawsze przyklejony do lewej krawędzi okna, niezależnie od długości strony.

## 2. Zwijane źródła na karcie produktu (`src/routes/_auth/projects.$id.products.$pid.tsx`)

Lista źródeł rozpycha stronę pionowo. Zamieniamy każdą kartę źródła na **Collapsible** (z `@/components/ui/collapsible`, już w projekcie):

- Domyślny stan:
  - Pierwsze źródło (`i === 0`) — **otwarte**.
  - Reszta — **zamknięte**.
- Pasek nagłówka źródła (zawsze widoczny, klikalny `CollapsibleTrigger`):
  - `#i` + tytuł + URL (skrócony).
  - Miniatura główna po prawej (`h-12 w-12 rounded-xl`).
  - Liczba zdjęć (`{count} zdjęć`).
  - Ikona chevron, rotowana gdy otwarte.
- `CollapsibleContent`:
  - Pełna siatka miniatur (jak teraz).
  - Opis w pudełku z `max-h-64 overflow-auto`.
  - Przycisk "Regeneruj tylko z tego źródła" (pill style `rounded-full`).
- Nad listą dodajemy mały toolbar:
  - Przyciski **"Rozwiń wszystkie / Zwiń wszystkie"** (pill, ghost).

Stan otwarcia trzymany w lokalnym `useState<Record<string, boolean>>` keyowanym po `s.url`.

## Zakres techniczny
- Wyłącznie 2 pliki: `src/routes/_auth.tsx` i `src/routes/_auth/projects.$id.products.$pid.tsx`.
- Bez nowych zależności (Collapsible już mamy).
- Bez zmian logiki, query, server functions ani danych.
