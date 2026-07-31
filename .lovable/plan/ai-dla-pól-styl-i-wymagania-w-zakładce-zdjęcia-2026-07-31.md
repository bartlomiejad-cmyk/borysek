# AI dla pól „Styl" i „Wymagania" w zakładce Zdjęcia

## Co zbudujemy

W karcie ustawień projektu zdjęciowego (Styl / scena oraz Wymagania PL) dochodzą przyciski AI:

- **Wygeneruj AI** — gdy pole jest puste, AI tworzy propozycję treści na podstawie nazwy projektu, produktów w projekcie (nazwy, opisy) i drugiego pola, jeśli jest wypełnione.
- **Popraw AI** — otwiera małe pole „co zmienić" (np. „bardziej minimalistycznie, jasne tło") i AI przepisuje aktualną treść pola zgodnie z instrukcją.

Wynik trafia do pola tekstowego jako propozycja — użytkownik może ją edytować i dopiero potem klika „Zapisz ustawienia". Nic nie zapisuje się automatycznie.

Podczas pracy AI przycisk pokazuje spinner, a błędy (limit, brak kredytów) pojawiają się jako czytelny komunikat.

## Szczegóły techniczne

- Nowy server function `suggestPhotoPrompt` w `src/lib/photo-tool/photo-tool.functions.ts`:
  - middleware `requireSupabaseAuth`
  - wejście: `{ projectId, field: "style" | "requirements", mode: "generate" | "refine", currentText?, instruction? }`
  - pobiera projekt + do 10 produktów (nazwa, opis) przez RLS-owy `context.supabase` jako kontekst
  - woła Lovable AI Gateway (`/v1/chat/completions`, model `google/gemini-3.6-flash`) z polskim system promptem osobnym dla „styl/scena" i „wymagania PL”
  - zwraca `{ text: string }`; mapuje 429/402 na czytelne komunikaty PL
- UI w `src/routes/_auth/photo.$id.tsx` (sekcja ustawień, ok. linie 171–194): dwa przyciski przy każdym z pól + inline input na instrukcję dla trybu „Popraw AI”, obsługa przez `useServerFn` + `useMutation`, wynik ustawiany przez `setStyle` / `setReqPl`.
- Bez zmian w schemacie bazy.
