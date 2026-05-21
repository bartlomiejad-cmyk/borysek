# WebP po naszej stronie + auto-pin wygenerowanego zdjęcia

## Problem

1. `fal-ai/imageutils/image-conversion` często nie zwraca WebP — w efekcie do bucketu trafia JPEG zamiast docelowego `2560x2560 .webp`.
2. Po regeneracji użytkownik musi jeszcze ręcznie kliknąć "Pin", żeby wygenerowane zdjęcie stało się głównym w galerii. Powinno to dziać się automatycznie.

## 1. Konwersja do WebP po naszej stronie (`src/lib/pim/regen.functions.ts`)

Środowisko: Cloudflare Worker (workerd) — `sharp` i natywne moduły Node odpadają. Używamy WASM-owego enkodera dostępnego w Workerach.

- Zależność: `@jsquash/webp` + `@jsquash/resize` (czyste WASM, działają na Workerach; WASM jest inline'owany przez Vite).
- Usuwamy krok `fal-ai/imageutils/image-conversion`.
- Nowy flow w `regenerateMainImage` po otrzymaniu `generatedUrl` z seedream:
  1. `fetch(generatedUrl)` → `ArrayBuffer`.
  2. Dekod do `ImageData` (PNG/JPEG — `@jsquash/png` lub `@jsquash/jpeg` w zależności od `content_type`; jeśli nie znamy, próbujemy JPEG → PNG fallback).
  3. Jeśli wymiary ≠ 2560x2560 → `@jsquash/resize` do 2560x2560 (lanczos3).
  4. Enkod `@jsquash/webp` (quality ~ 88).
  5. Upload jako `${enrichmentId}.webp` z `contentType: "image/webp"`.
- Zostaje czyszczenie starych wariantów (`.webp` i `.jpg`) przed uploadem, dokładnie jak teraz.
- Jeśli WASM padnie (np. dekoder nie rozpozna formatu), logujemy i robimy fallback: upload surowego `generatedUrl` jako `.jpg` (zachowane dotychczasowe zachowanie, żeby nie blokować użytkownika).

## 2. Auto-pin wygenerowanego zdjęcia jako głównego

W tym samym handlerze, w jednym `update`-cie do `enrichments`:

```ts
.update({
  regenerated_main_image: publicUrl,
  pinned_main_url: publicUrl,
})
```

Dzięki temu:
- Karta produktu (`projects.$id.products.$pid.tsx`) od razu pokazuje regen jako "Główne".
- Lista produktów (`projects.$id.index.tsx`) używa `pinned_main_url` jako miniatury → także się aktualizuje.
- Użytkownik nadal może odpiąć (`PinOff`) i wskazać inne zdjęcie ręcznie.

W `clearRegeneratedImage` dodajemy symetryczną logikę: jeżeli `pinned_main_url === regenerated_main_image`, zerujemy też `pinned_main_url` (żeby galeria nie wskazywała na usunięty plik).

## Zakres techniczny
- Zmiany w `src/lib/pim/regen.functions.ts` (jeden plik).
- Nowa zależność: `@jsquash/webp`, `@jsquash/jpeg`, `@jsquash/png`, `@jsquash/resize`.
- Bez migracji DB, bez zmian schematu, bez zmian UI.

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
