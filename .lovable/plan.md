## Cel

Właściciel projektu może wygenerować **publiczny link z hasłem** do listy wszystkich produktów w projekcie. Klient bez logowania:
- odblokowuje stronę hasłem,
- widzi listę produktów z danymi ze złotego rekordu (bez menu bocznego, bez UI narzędzia),
- może rozwinąć produkt inline (szybki podgląd) lub otworzyć pełną kartę produktu (`/preview`),
- dodaje komentarz ogólny do projektu lub komentarz do pojedynczego produktu,
- flaguje produkt jako „do poprawy".

Właściciel widzi komentarze i flagi w edytorze produktu i w liście projektu.

## Backend (Lovable Cloud)

### Migracja — nowe tabele

- `project_shares` — jeden aktywny link per projekt (można rotować):
  - `project_id`, `token` (unikalne, losowe 32B hex), `password_hash` (sha256 hasła + salt), `salt`, `is_active`, `created_by`.
- `client_feedback` — komentarze i flagi:
  - `project_id`, `product_id` (nullable — NULL = komentarz ogólny do projektu),
  - `kind` (`comment` | `needs_fix`),
  - `body` (text, max 2000),
  - `author_name` (opcjonalne, wpisywane w formularzu, max 80),
  - `share_token` (do audytu),
  - `resolved` (bool, default false — właściciel odhacza).

RLS:
- `project_shares`: SELECT/INSERT/UPDATE tylko właściciel projektu (`projects.user_id = auth.uid()`). Brak dostępu dla `anon`.
- `client_feedback`: SELECT/UPDATE tylko właściciel. **Insert wykonuje serwer** (server function pod publiczną trasą), więc RLS bez policy dla anon; write przez `supabaseAdmin` po weryfikacji tokenu+hasła.

GRANT-y dla `authenticated` i `service_role` wg zasad public schema.

### Publiczne endpointy w `src/routes/api/public/share/`

- `POST /api/public/share/unlock` — `{ token, password }` → weryfikuje hash, ustawia szyfrowany cookie sesyjny (`useSession`, `SESSION_SECRET`) z `{ token, unlockedAt }`. Rate-limit prosty w pamięci per token.
- `GET /api/public/share/list` — cookie musi mieć aktywny token; zwraca listę produktów projektu (nazwa, miniatura, złote SEO, opis HTML, cechy, galeria AI, licznik komentarzy, flaga „do poprawy").
- `GET /api/public/share/product/:pid` — pełne dane jednego produktu do widoku karty.
- `POST /api/public/share/feedback` — `{ productId|null, kind, body, authorName? }` z walidacją Zod; zapis przez `supabaseAdmin`.

Sekrety: `SESSION_SECRET` (generate_secret, 64 znaki) — dodać jeżeli nie ma. Hasło do udostępniania NIE trafia do env — jest per projekt, hashowane w DB.

### Server functions dla właściciela (`src/lib/pim/shares.functions.ts`)

- `createOrRotateShare({ projectId, password })` — hashuje hasło (sha256 + random salt), upsertuje `project_shares`, zwraca `{ token, url }`.
- `revokeShare({ projectId })` — `is_active=false`.
- `listFeedback({ projectId })` — komentarze + flagi z produktami.
- `resolveFeedback({ id, resolved })`.

## Frontend

### Panel właściciela

- **`src/routes/_auth/projects.$id.index.tsx`**:
  - Nowy kafelek/przycisk **„Udostępnij klientowi"** → dialog `ShareProjectDialog.tsx`:
    - Pole hasła + generator, przycisk „Utwórz link" / „Rotuj hasło", kopiowanie URL, przycisk „Wyłącz link".
  - Odznaka z liczbą nieprzeczytanych komentarzy / flag „do poprawy" przy produktach na liście (dot koło nazwy).
  - Sekcja „Komentarze klienta" (rozwijana) — lista z filtrem `nierozwiązane`, klik → edytor produktu; komentarze ogólne wyświetlone osobno.

- **`src/routes/_auth/projects.$id.products.$pid.tsx`**:
  - Panel „Komentarze klienta" z listą wpisów, badge „do poprawy", przycisk „Oznacz jako rozwiązane".

### Widok klienta (publiczny, bez `_auth`)

Nowe pliki pod `src/routes/share.$token.tsx` i `src/routes/share.$token.unlock.tsx` — poza layoutem `_auth`, bez sidebaru narzędzia. Własny minimalny layout (logo klienta lub neutralny nagłówek + stopka).

- **`/share/$token/unlock`** — formularz hasła; POST do `/api/public/share/unlock`; po sukcesie redirect na `/share/$token`.
- **`/share/$token`** — `beforeLoad` waliduje cookie sesji przez server fn; jeśli brak → redirect na unlock. Loader pobiera listę produktów.
  - **Widok**: lista kart produktów; każda karta rozwija się **inline** (accordion) i pokazuje: galerię AI, opis HTML, cechy, SEO, przycisk „Otwórz pełną kartę" (link do `/share/$token/p/$pid`).
  - Nad listą pole „Komentarz ogólny do projektu" + lista dotychczasowych ogólnych komentarzy klienta.
  - Pod każdą kartą: pole komentarza + toggle „Do poprawy" (checkbox) + opcjonalne imię; „Wyślij".
- **`/share/$token/p/$pid`** — pełna karta produktu (kopia layoutu `_preview` bez toolingu Lovable) z panelem komentarzy z boku i toggle „Do poprawy".

Brak nawigacji do reszty aplikacji, brak linków do logowania. `robots: noindex` w head każdej trasy share.

## Bezpieczeństwo

- Hasło porównywane server-side timing-safe (sha256+salt, `timingSafeEqual`).
- Cookie `httpOnly`, `secure`, `sameSite=lax`, TTL 7 dni; scope per token (`{ token, unlockedAt }`).
- Rate-limit unlock: max 10 prób / 10 min per token (in-memory Map w workerze — best effort).
- `client_feedback.body` sanitizowane przez limit długości + escape HTML przy renderze (bez `dangerouslySetInnerHTML` dla treści klienta).
- Rotacja hasła unieważnia cookie (token się nie zmienia, ale zmiana `password_hash` → `unlock` znów wymagany; cookie waliduje `unlockedAt >= password_updated_at`).
- Publiczne endpointy zwracają wyłącznie pola przeznaczone dla klienta (bez `user_id`, bez pól administracyjnych).

## Pliki do dodania / edycji

Nowe:
- Migracja: `project_shares`, `client_feedback` + GRANT + RLS.
- `src/lib/pim/shares.functions.ts` (owner RPC).
- `src/routes/api/public/share/unlock.ts`, `list.ts`, `product.$pid.ts`, `feedback.ts`.
- `src/routes/share.$token.unlock.tsx`, `src/routes/share.$token.tsx`, `src/routes/share.$token.p.$pid.tsx`.
- `src/components/pim/ShareProjectDialog.tsx`, `src/components/share/ClientFeedbackForm.tsx`, `src/components/share/ProductAccordionCard.tsx`.

Edycje:
- `src/routes/_auth/projects.$id.index.tsx` — kafelek udostępniania + panel feedbacku + odznaki na liście.
- `src/routes/_auth/projects.$id.products.$pid.tsx` — sekcja komentarzy klienta + oznaczanie jako rozwiązane.

Sekret: `SESSION_SECRET` (generate_secret).

Bez zmian w edytorze produktu poza dodaniem panelu komentarzy; layout `/preview` pozostaje jak jest (klient używa równoległej trasy `/share/$token/p/$pid`, żeby nie widzieć środowiska aplikacji).
