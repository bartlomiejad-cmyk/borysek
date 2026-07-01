# Wytyczne PL → prompty EN + bogatsza miniaturka

## Co powstanie

1. **Nowe pole „Wymagania (PL)" na poziomie projektu zdjęciowego.** W panelu ustawień projektu (obok „Styl / scena") dojdzie duże pole tekstowe, gdzie po polsku opisujesz oczekiwania — np. „miniaturka: produkt na białym tle z 2–3 listkami i wiórami trawy z lewej strony; wizualizacja: ogród, poranne światło, dłoń trzymająca sekator".
2. **Automatyczne przepisanie na profesjonalny prompt EN.** Przed każdą generacją worker wywołuje `google/gemini-3.1-pro-preview` przez Lovable AI Gateway z: nazwą produktu, opisem produktu, wytycznymi PL i informacją, czy to miniaturka czy wizualizacja. Gemini zwraca dwa gotowe prompty EN (jeden dla miniaturki, jeden dla wizualizacji) w ustalonym formacie JSON. Prompty są cache'owane per produkt, żeby nie mielić tego samego wywołania przy każdej wizualizacji.
3. **Nowy styl miniaturki — packshot+.** Domyślny szablon promptu miniaturki dopuszcza teraz białe tło + 1–3 kontekstowe elementy związane z produktem (np. listki dla sekatora, ziarna kawy dla młynka, deska + noże dla ostrzarki). AI samo dobiera dodatki na podstawie opisu produktu; jeśli wytyczne PL zawierają konkretne wskazówki, one mają pierwszeństwo.
4. **Wizualizacje bez zmian jakościowych, tylko sterowane z PL.** Aktualne prompty lifestyle zostają jako baza; wytyczne PL nadpisują scenę i rekwizyty.
5. **Podgląd wygenerowanego promptu (opcjonalnie).** W panelu produktu — po wygenerowaniu — pokazujemy w rozwijanym akapicie prompty EN, których użyliśmy dla miniaturki i wizualizacji, żebyś mógł zweryfikować co poszło do FAL.

## Jak to zadziała krok po kroku

```text
[Panel projektu]
  └ pole „Wymagania (PL)" ─────────────┐
                                       ▼
[Worker: runPhotoToolGenerate(product)]
  1. pobiera projekt (styl + wytyczne PL) + produkt (nazwa, opis, źródła)
  2. jeśli wytyczne PL się zmieniły od ostatniego cache → wywołanie Gemini Pro
     ├─ input: nazwa, opis, wytyczne PL, liczba wizualizacji
     └─ output JSON: { thumbnail_prompt, lifestyle_prompt }
  3. cache promptów w polu enrichments produktu (żeby nie płacić za każdą wiz.)
  4. FAL nano-banana-pro/edit × (1 + N) używa gotowych promptów EN
  5. zapis miniaturki + wizualizacji jak dziś
```

## Szczegóły techniczne

- **Schemat**: do `photo_projects` dodajemy kolumnę `requirements_pl text`. Do `photo_products` dodajemy `generated_thumb_prompt text`, `generated_lifestyle_prompt text`, `prompt_source_hash text` (hash z `requirements_pl + name + description + style_prompt` — jeśli się zmieni, generujemy prompty od nowa).
- **Nowa funkcja `buildFalPromptsFromPolish` w `src/lib/pim/_workers.server.ts`**: strukturalne wywołanie `generateText` z `Output.object({ schema: z.object({ thumbnail_prompt: z.string(), lifestyle_prompt: z.string() }) })` do `google/gemini-3.1-pro-preview`. System prompt instruuje model, że pisze prompty do modelu edycji obrazu FAL nano-banana-pro, ma zachować wierność produktowi i przetłumaczyć PL wytyczne na precyzyjne angielskie instrukcje (framing, tło, rekwizyty, oświetlenie, zakazy).
- **Nowy szablon miniaturki**: jeśli `requirements_pl` jest puste, używamy rozbudowanego promptu bazowego z instrukcją „white seamless background BUT include 1–3 contextual props/materials clearly related to the product (leaves, wood shavings, coffee beans, fabric etc.) arranged asymmetrically around the product" — czyli styl jak na przesłanym przykładzie. Reszta reguł (preserve labels, no watermarks) zostaje.
- **UI**:
  - `src/routes/_auth/photo.$id.tsx` — dodane pole `Textarea` „Wymagania (PL)" w bloku ustawień projektu, z placeholderem-przykładem.
  - Nowy zwijany blok „Prompty EN użyte do generacji" pod kafelkiem produktu (widoczny gdy prompty są zapisane).
- **`src/lib/photo-tool/photo-tool.functions.ts`** — `updatePhotoProject` przyjmuje nowe pole `requirements_pl`; `getPhotoProject` je zwraca; typ `PhotoProduct` dostaje 2 nowe pola z promptami do wyświetlenia.
- **Bez zmian**: model FAL (`fal-ai/nano-banana-pro/edit`), rozdzielczość 2K, reguła N zdjęć = 1 miniaturka + N-1 wizualizacji, kolejkowanie i logi.

## Poza zakresem tej iteracji

- Edycja promptów EN ręcznie w UI (można dodać później jako „nadpisz prompt").
- Osobne wytyczne per produkt (na razie tylko globalne per projekt — możemy dodać override, gdy okaże się potrzebne).
- Regeneracja tylko miniaturki bez wizualizacji (dziś generuje się cała paczka).
