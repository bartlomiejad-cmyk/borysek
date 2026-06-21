## Cel

Rozszerzyć generowanie "golden" treści produktu o pełen zestaw SEO best practices. Output AI ma zawierać nie tylko nazwę/opis/cechy, ale również elementy bezpośrednio konsumowane przez wyszukiwarki i platformy e-commerce.

## Zmiany w bazie (migracja)

Dodać do `public.enrichments` 3 nowe kolumny:

- `golden_slug text` — SEO-friendly URL slug (kebab-case, bez polskich znaków, max 75 zn.)
- `golden_meta_description text` — meta description 150-160 zn.
- `golden_seo_keywords jsonb` — `string[]` z naturalnymi frazami (main + long-tail), max 8

`golden_features` zostaje (jsonb), ale od teraz klucze będą standaryzowane pod schema.org Product (patrz niżej).

## Zmiany w `src/lib/pim/_workers.server.ts`

### 1. Rozszerzenie `GoldenSchema` (z.object)

```ts
{
  name: string (min 1, max 150),
  slug: string (regex kebab-case, max 75),
  description: string (min 1, max 20000),
  meta_description: string (max 200),
  seo_keywords: string[] (max 8),
  features: [{ key: string, value: string }] (max 60)
}
```

### 2. Nowy `systemPrompt` w `generateGolden` — best practices SEO

Sekcja **NAZWA (`name`)**:
- 40-70 znaków (optymalne pod `<title>`)
- Format: `[marka] [model/typ produktu] [kluczowa cecha różnicująca]`
- Najważniejsze słowo kluczowe (typ produktu) w pierwszych 30 znakach
- Bez ALL CAPS, bez znaków specjalnych poza myślnikiem

Sekcja **SLUG (`slug`)**:
- kebab-case (`buty-trekkingowe-meskie-salomon-x-ultra-4`)
- Transliteracja polskich znaków (ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź/ż→z)
- Max 75 znaków, tylko `[a-z0-9-]`
- Bez stop-words (`i`, `oraz`, `dla`, `z`, `w`, `na`) gdy nie zmieniają sensu
- Zawiera główne słowo kluczowe na początku

Sekcja **DESCRIPTION** (rozszerzenie istniejących reguł):
- 350-900 znaków (bez zmian)
- **Główne słowo kluczowe (typ produktu) MUSI pojawić się w pierwszych 100 znakach**
- Pierwsze zdanie odpowiada na pytanie "co to jest i dla kogo"
- W treści wpleść 2-3 naturalne warianty frazy (synonimy, long-tail) — bez upychania (keyword stuffing)
- Akapity 2-4 zdania (czytelność = pośredni sygnał rankingowy)
- Pozostałe dotychczasowe zakazy (marketingowe ogólniki, ceny, sklepy, "kup teraz") bez zmian

Sekcja **META_DESCRIPTION**:
- 150-160 znaków (twardy limit; odcięcie w Google ~160)
- Streszczenie + jedna konkretna korzyść/cecha + naturalna fraza kluczowa
- Brak cudzysłowów (psuje renderowanie w SERP)
- Brak duplikatu pierwszego zdania opisu — komplementarny, nie identyczny

Sekcja **SEO_KEYWORDS**:
- 3-8 fraz, lower-case
- 1 fraza główna (typ produktu) + 2-3 średnie (typ + cecha) + 2-4 long-tail (3-5 słów, intencja kupującego)
- Tylko frazy realnie wynikające ze źródeł i właściwości produktu — bez halucynacji marek
- Brak duplikatów i fraz < 2 słów (poza nazwą kategorii)

Sekcja **FEATURES — standaryzacja pod schema.org/Product**:
- Preferowane klucze (gdy aplikowalne, po polsku jako display, ale spójne nazwy):
  `Marka`, `Model`, `Materiał`, `Kolor`, `Wymiary`, `Waga`, `Pojemność`, `Moc`, `Zasilanie`, `Wydajność`, `Gwarancja`, `Kraj produkcji`, `EAN`, `Rozmiar`, `Płeć`, `Wiek`, `Przeznaczenie`
- Te kluczowe atrybuty trafiają potem do JSON-LD Product (`brand`, `material`, `color`, `weight`, `gtin13` itd.)
- Pozostałe reguły bez zmian (max 60, konkrety, bez marketingu)

### 3. Walidacja po stronie kodu (post-processing w handlerze)

Po `GoldenSchema.parse`:
- Wymusić limit długości `meta_description` (truncate do 160 z kropką jeśli AI przesadzi)
- Wymusić limit nazwy (truncate do 70 jeśli > 70, z zachowaniem słów)
- Re-slugify `slug` po stronie kodu (helper `slugifyPl`) — niezależnie od tego co zwróciło AI, gwarantujemy poprawność
- De-duplikacja `seo_keywords` (lowercase + trim)
- Wszystko przepuszczane przez istniejący `sanitize(..., blacklist)`

### 4. Zapis do bazy

`updatePayload` w `generateGolden` rozszerzony o:
```ts
golden_slug, golden_meta_description, golden_seo_keywords
```

`previous` (jsonb) zachowuje też poprzednie wartości nowych pól — żeby regeneracja pozwalała wrócić.

### 5. Helper `slugifyPl` (nowy, w tym samym pliku)

Czysta funkcja: input string → kebab-case bez diakrytyków, max 75 zn., bez stop-words.

## Co NIE jest w zakresie tego planu

- UI: ten plan nie zmienia komponentów PIM. Nowe pola będą dostępne w bazie i można je w kolejnym kroku pokazać w `ProductDetailDrawer`/edytorze i eksporcie CSV. Powiedz, jeśli chcesz to zrobić od razu — wrzucę osobnym krokiem.
- Eksport do Shopify / sitemap.xml / JSON-LD na publicznych stronach produktów — to byłby osobny moduł (i wymaga ustalenia gdzie strony produktów mają żyć).
- Zmiana modelu AI ani limitów Firecrawl/tokenów (zostawiamy ostatnie optymalizacje).

## Weryfikacja

1. Migracja przechodzi, kolumny widoczne w `enrichments`.
2. Uruchomić generowanie dla 1 produktu → w bazie `golden_slug`, `golden_meta_description`, `golden_seo_keywords` zapisane i niepuste.
3. Sprawdzić: `meta_description ≤ 160`, `slug` matchuje `/^[a-z0-9-]+$/`, `seo_keywords` to tablica 3-8 fraz.
4. Sprawdzić, że `golden_name`, `golden_description`, `golden_features` dalej działają (regresja).
