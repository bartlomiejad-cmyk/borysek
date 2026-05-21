# Plan naprawy błędu regenerowania zdjęcia

## Co się dzieje
Regeneracja zwraca pełny HTML strony błędu (`This page didn't load`), czyli po stronie serwera dochodzi do awarii zanim aplikacja zdąży zwrócić normalny komunikat błędu. Najbardziej podejrzany fragment to obecna konwersja WebP oparta o importy `.wasm` w `src/lib/pim/regen.functions.ts` — takie importy są wykonywane przy ładowaniu modułu funkcji serwerowej i mogą wysadzić cały endpoint regeneracji.

## Zakres naprawy

1. **Usunąć ryzykowne importy WASM z modułu regeneracji**
   - Nie importować `.wasm` na górze `regen.functions.ts`.
   - Nie ładować `@jsquash/*` przy starcie modułu funkcji serwerowej.
   - Dzięki temu błąd konwersji obrazu nie będzie zamieniał całego requestu w stronę `This page didn't load`.

2. **Rozdzielić regenerację od konwersji**
   - Regeneracja przez FAL/Seedream zostaje głównym krokiem.
   - Pobranie wygenerowanego pliku, upload do storage i zapis `regenerated_main_image` oraz `pinned_main_url` mają działać niezależnie od konwersji WebP.
   - Jeśli konwersja nie powiedzie się, użytkownik dostanie czytelny błąd albo bezpieczny fallback, a nie HTML strony awarii.

3. **Przywrócić WebP w bezpieczniejszy sposób**
   - Zamiast lokalnej konwersji WASM w funkcji serwerowej użyć zewnętrznej konwersji po wygenerowaniu obrazu.
   - Wynik walidować po `Content-Type` i nagłówku pliku (`RIFF....WEBP`).
   - Tylko prawdziwy WebP zapisujemy jako `.webp`; jeśli konwerter zwróci inny format, zapisujemy fallback i logujemy przyczynę.

4. **Poprawić komunikat błędu w UI**
   - Jeśli serwer zwróci HTML zamiast JSON/normalnego błędu, pokazać krótki komunikat po polsku typu: „Regeneracja nie powiodła się po stronie serwera”, bez wklejania całego HTML-a w toast.

5. **Weryfikacja**
   - Sprawdzić, że funkcja regeneracji nie ładuje już WASM przy imporcie.
   - Uruchomić kontrolę TypeScript.
   - Zweryfikować, że udana regeneracja nadal automatycznie ustawia wygenerowane zdjęcie jako główne w produkcie i na liście produktów.

## Pliki do zmiany

- `src/lib/pim/regen.functions.ts`
- `src/routes/_auth/projects.$id.products.$pid.tsx`
- `src/routes/_auth/projects.$id.index.tsx`
