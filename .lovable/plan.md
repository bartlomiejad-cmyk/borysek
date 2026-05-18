# Fix: Logowanie Google nie kończy procesu

## Problem
Po wybraniu konta Google w popupie/oknie OAuth nic się nie dzieje — użytkownik zostaje na `/login`. Logi auth pokazują, że sesja jest poprawnie tworzona po stronie Supabase (token + login OK), więc problem jest po stronie front-endu: brak nawigacji po zakończeniu flow OAuth.

## Przyczyna
W `src/routes/login.tsx` funkcja `google()` wywołuje `lovable.auth.signInWithOAuth(...)`, ale ignoruje dwa scenariusze z dokumentacji:
1. `result.redirected === true` — przeglądarka przekierowuje do Google, kod powinien po prostu zwrócić.
2. Brak `redirected` — tokeny już wróciły, sesja jest ustawiona, ale **trzeba ręcznie wykonać `navigate({ to: "/projects" })`**. Obecny kod tylko ustawia `loading=false` i nic więcej, więc użytkownik tkwi na `/login`.

Dodatkowo `useEffect` na `/login` sprawdza sesję tylko raz przy montażu — nie reaguje na późniejsze pojawienie się sesji (np. gdy flow OAuth wraca w tym samym oknie bez pełnego remontu).

## Plan zmian (1 plik)

### `src/routes/login.tsx`
1. Obsłużyć wynik `signInWithOAuth` zgodnie z dokumentacją: `if (result.error) toast; if (result.redirected) return; navigate({ to: "/projects" });`
2. Dodać listener `supabase.auth.onAuthStateChange` w `useEffect`, który nawiguje do `/projects` po wykryciu sesji (zabezpieczenie na wypadek, gdy callback OAuth wraca w tym samym oknie).
3. Posprzątać subskrypcję w cleanup.

## Uwaga środowiskowa
Jeśli problem występuje tylko w iframe podglądu Lovable, opublikowana wersja zwykle działa poprawnie (preview ma inne origin/redirect rules). Po wprowadzeniu poprawki warto przetestować na opublikowanym URL.
