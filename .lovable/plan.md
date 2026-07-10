## Cel

Złoty opis produktu ma być zawsze poprawnym HTML-em, zaczynać się od `<h3>` z nazwą produktu, a jeśli produkt ma cechy — zawierać wypunktowanie (`<ul><li>`) z tymi cechami. Zmiana obejmuje generator AI, walidator/sanitizer, zapis manualny oraz miejsca, które renderują opis.

## Zakres zmian

### 1. Generator złotego rekordu (prompt) — `src/lib/pim/seo.ts`
Sekcja `## OPIS (description)` w `GOLDEN_SEO_SYSTEM_PROMPT` dostaje nowe wymagania:
- Wynik MUSI być fragmentem HTML (bez `<html>/<body>`).
- Pierwszy element: `<h3>{golden name}</h3>`.
- Następnie 1–3 akapity `<p>…</p>` (bez marketingowych ogólników — dotychczasowe zakazy zostają).
- Jeśli są cechy techniczne (features): dopisz `<ul><li><strong>Klucz:</strong> wartość</li>…</ul>` powtarzając max 10 najważniejszych cech (reszta zostaje wyłącznie w `features[]`).
- Dozwolone tagi: `h3, p, ul, ol, li, strong, em, br`. Bez inline stylów, klas, linków, obrazów, skryptów.
- Długość 350–1200 znaków tekstu widocznego (bez tagów).

### 2. Sanitizer HTML (nowy) — `src/lib/pim/seo.ts`
Dodaję `sanitizeGoldenDescriptionHtml(html, { name, features })`:
- Whitelist tagów `h3,p,ul,ol,li,strong,em,br`; wszystkie atrybuty usuwane.
- Jeśli brak `<h3>` na początku → wstrzyknięcie `<h3>{name}</h3>` z użyciem `golden_name`.
- Jeśli AI zwróciło zwykły tekst (brak jakiegokolwiek tagu) → owijamy akapitami po pustych liniach i doklejamy `<h3>` + opcjonalne `<ul>` z cechami.
- Jeśli są `features` i w HTML nie ma żadnego `<ul>/<ol>` → dopięcie automatycznej listy z pierwszych 10 cech.
- Kolapsowanie białych znaków, escape'owanie tekstu wewnątrz tagów.

### 3. Wywołania generatora — `src/lib/pim/_workers.server.ts` i `src/lib/pim/ai.functions.ts`
- W obu ścieżkach po odebraniu odpowiedzi AI opis przechodzi przez `sanitizeGoldenDescriptionHtml` z finalnym `name` i `features` (już po scaleniu z istniejącymi). Do bazy trafia HTML.
- Bez zmian w schemacie DB (`golden_description` to nadal `text`).

### 4. Zapis manualny opisu — `src/lib/pim/queries.functions.ts` (`saveGoldenBasics`) oraz edytor `src/routes/_auth/projects.$id.products.$pid.tsx`
- Server-side: sanitizer uruchamiany też przy manualnym zapisie (wygodne dla użytkownika i chroni przed śmieciowym HTML-em).
- Edytor: pole opisu przełączane na prosty edytor HTML (textarea z HTML-em + krótka podpowiedź „HTML: h3, p, ul, li, strong, em"). Bez wprowadzania edytora WYSIWYG — poza scope'em tej zmiany.

### 5. Renderowanie opisu (klient)
Miejsca, które teraz renderują `golden_description` jako plain text z `whitespace-pre-wrap`, przełączam na `dangerouslySetInnerHTML` z klasą `prose`:
- `src/routes/_auth/projects.$id.products.$pid_.preview.tsx` — zakładka „Opis" (usuwam `<h1>` z nazwą albo zostawiam i zdejmuję `<h3>` z HTML-a przy renderze; wybieram: **zostawiam nagłówek strony `<h1>`, a HTML opisu renderuję jak jest — `<h3>` staje się śródtytułem sekcji „Opis"**).
- `src/routes/_auth/projects.$id.products.$pid.tsx` — podgląd opisu w edytorze produktu (mały panel prose obok textarei / w miejscu obecnego preview).

### 6. Eksport CSV — `src/lib/pim/export.functions.ts`
- Bez zmian w kolumnach; `golden_description` wychodzi jako HTML (zgodne z tym, jak sklepy internetowe importują opisy).

## Zmiany plików (skrót)

```text
src/lib/pim/seo.ts                                       (prompt + sanitizer)
src/lib/pim/_workers.server.ts                           (sanitize po AI)
src/lib/pim/ai.functions.ts                              (sanitize po AI)
src/lib/pim/queries.functions.ts                         (sanitize przy manualnym zapisie)
src/routes/_auth/projects.$id.products.$pid.tsx         (render HTML w podglądzie + hint)
src/routes/_auth/projects.$id.products.$pid_.preview.tsx (render HTML w zakładce Opis)
```

## Poza zakresem

- Bogaty edytor WYSIWYG (Tiptap/Lexical) — zostaje textarea z HTML-em.
- Zmiana schematu DB / migracje — nie potrzeba.
- Migracja istniejących opisów plain-text w bazie: przy pierwszym renderze, jeśli wartość nie zawiera żadnego tagu, sanitizer po stronie serwera przy najbliższym zapisie/generacji przekształci ją do HTML; w widoku klienta plain-text bez tagów będzie renderowany jako `<p>` (fallback w sanitizerze wywoływanym też przed `dangerouslySetInnerHTML`).