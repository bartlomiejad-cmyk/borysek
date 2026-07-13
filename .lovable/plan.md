## Problem
Tworzenie linku udostępniania (`shares.functions.ts` → `hashSharePassword`) używa PBKDF2 z 120 000 iteracji. Runtime Cloudflare Workers (workerd) na którym działa aplikacja wspiera maksymalnie 100 000 iteracji dla PBKDF2 i zwraca błąd „Pbkdf2 failed: iteration counts above 100000 are not supported (requested 120000)".

## Zmiana
- `src/lib/pim/shares-crypto.server.ts`: zmniejszyć `iterations` z `120_000` do `100_000` w `pbkdf2Sync(...)`.
- Bez migracji DB — dotychczas nie udało się zapisać żadnego share'a z tą liczbą iteracji (fn nie działała), więc nie ma niekompatybilnych hashów do przemigrowania. Jeśli w bazie już istnieją stare zapisy z ewentualnej wcześniejszej wersji, nadal działają — ale nowe będą tworzone z 100k.

## Weryfikacja
- Otworzyć „Udostępnij klientowi", wpisać hasło, kliknąć „Utwórz link" → sukces, generowany link.
- Wejść w link, wpisać hasło → poprawne zalogowanie do widoku share.
