## Problem

FAL zwraca `422 – Could not generate images with the given prompts and images` na `fal-ai/nano-banana-pro/edit`. Obecny retry używa uproszczonego promptu, ale **nadal wysyła to samo zdjęcie referencyjne** — jeśli model odrzuca właśnie obraz (np. amunicja, broń, treści wrażliwe, twarze, znaki towarowe), każda kolejna próba edycji da to samo 422.

Do tego obecny komunikat błędu w bulk_job jest ogólny („brak url" / surowy tekst 422), więc nie widać dlaczego.

## Rozwiązanie

Trzy zmiany w `src/lib/pim/_workers.server.ts` (funkcja `runPimVisualization`, ~1970–2050):

1. **Drugi fallback: text-to-image bez referencji.**  
   Kiedy pierwszy retry z uproszczonym promptem też zwróci 422, wywołać `fal-ai/nano-banana-pro` (endpoint generate, nie `/edit`) z promptem czysto opisowym zbudowanym z `nameForPrompt` + `descForPrompt` + `projectStyle` — bez `image_urls`. To zdejmuje z modelu obowiązek „zachowaj produkt", który przy amunicji / wrażliwych obrazach powoduje odmowę. Wynik trafia do tego samego `ai_gallery_urls` z oznaczeniem w logu, że jest to render bez referencji.

2. **Wykrywanie 422 przez status, nie regex.**  
   `callFal` obecnie rzuca `Error("FAL ... 422: ...")` i worker parsuje `\b422\b` z komunikatu — kruche (np. gdy w treści też jest liczba). Wprowadzić lekki podtyp błędu (klasa `FalHttpError` z polem `status`) i sprawdzać `err.status === 422`. Reszta wywołań `callFal` (thumbnail, regen slotów) działa bez zmian, tylko lepiej diagnozuje.

3. **Twardy komunikat w bulk_job po pełnym niepowodzeniu.**  
   Gdy oba retry (edit-safe + generate-only) zwrócą 422, ustawić `lastFalErr` na czytelne PL: „FAL odrzucił zarówno edycję jak i generowanie od zera (422) — najpewniej treść uznana za wrażliwą". `runPimVisualization` już rzuca błąd przy 0 obrazów — ten string trafi do `bulk_job.last_error` i użytkownik zobaczy powód zamiast surowego „422".

Bez zmian w UI, promptach SEO ani innych workerach.

## Weryfikacja

Odpalić „Wizualizacje" na produkcie który wcześniej dawał 0 obrazów (screenshot: „Filtry Do Rekuperatora Wanas…" — tu edit powinien przejść od razu; oraz na produkcie z amunicją Norma .223 — powinno spaść do generate-only i zwrócić obraz bez referencji lub czytelny błąd w `bulk_job.last_error`).
