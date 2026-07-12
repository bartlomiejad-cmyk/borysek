## Cel
W dialogu `GenerateVisualizationsDialog` dodać dwa osobne przyciski „✨ Zaproponuj AI" — jeden przy polu **Styl/scena**, drugi przy **Wymagania (PL)**. AI generuje treść na podstawie nazwy projektu (bez konkretnych produktów).

## Zmiany

### 1. Nowy server function — `src/lib/pim/ai.functions.ts`
Dodać `suggestVisualizationField({ projectId, field })`:
- `field: "style" | "requirements"`
- `.middleware([requireSupabaseAuth])`, waliduje wejście Zod.
- Pobiera `projects.name` (+ opcjonalnie `visualization_style_prompt` / `visualization_requirements_pl` jako lekki kontekst — dla drugiego pola przekazuje styl, żeby wymagania były spójne).
- Woła Lovable AI Gateway (`openai/gpt-5.5`, `generateText`) z krótkim promptem PL:
  - dla `style`: 1–2 zdania opisujące scenę/otoczenie pasujące do kategorii wynikającej z nazwy projektu,
  - dla `requirements`: 2–4 konkretne wymagania fotograficzne (kąt, światło, tło, kompozycja) po polsku.
- Zwraca `{ text: string }` (bez schematów `Output.object` — prosty tekst).
- Obsługa błędów 429/402 → czytelny komunikat.

### 2. `src/components/pim/GenerateVisualizationsDialog.tsx`
- Import `useServerFn` + `suggestVisualizationField`, ikona `Sparkles`.
- Dwa mini-przyciski (`variant="ghost"`, `size="sm"`) w prawym górnym rogu każdego `Label` (flex justify-between):
  - „✨ Zaproponuj" przy „Styl / scena"
  - „✨ Zaproponuj" przy „Wymagania (PL)"
- Osobne stany `busyStyle`, `busyReq` (spinner na przycisku, disabled w trakcie).
- Po sukcesie wpisuje treść do odpowiedniego pola (nadpisuje bieżącą wartość; jeśli pole nie jest puste — potwierdzenie przez `window.confirm`? — pomijamy, po prostu nadpisujemy, użytkownik może cofnąć Ctrl+Z lub edytować).
- Toast błędu przez `friendlyError`.

## Poza zakresem
- Bez zmian w workerze wizualizacji, promptach FAL, DB.
- Bez zapamiętywania sugestii jako osobne pole — po prostu wpisuje do formularza (i tak zapisze się przy „Uruchom" przez `updateProject`).

## Weryfikacja
1. Otworzyć dialog wizualizacji w projekcie → kliknąć „✨ Zaproponuj" przy Styl → pole wypełnia się propozycją PL.
2. To samo dla Wymagań.
3. „Uruchom" nadal działa — wartości trafiają do `projects` i do bulk joba.
