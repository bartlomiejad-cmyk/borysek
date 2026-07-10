## Cel
Kliknięcie **„Podgląd karty”** ma otwierać nową kartę z pełnym widokiem karty produktu dla konkretnego projektu i produktu, bez utraty docelowego URL-a po wejściu przez logowanie.

## Plan zmian
1. **Zachować docelowy adres przy blokadzie auth**
   - W layoutcie chronionych tras `_auth` zmienić przekierowanie na `/login`, aby dopisywało parametr `redirect` z aktualnym URL-em.
   - Dzięki temu wejście na `/projects/{id}/products/{pid}/preview` jako niezalogowany użytkownik nie będzie gubione.

2. **Poprawić login, żeby wracał do docelowej strony**
   - Login odczyta `redirect` z parametrów wyszukiwania.
   - Jeśli sesja już istnieje albo logowanie zakończy się sukcesem, aplikacja przeniesie użytkownika do `redirect`, a nie zawsze do `/projects`.
   - Dodać bezpieczny fallback: jeśli `redirect` nie istnieje lub jest niepoprawny, wracamy do `/projects`.

3. **Poprawić OAuth Google**
   - Przekierowanie OAuth nadal powinno wracać na bezpieczny adres origin, ale intencję docelowej strony zachowamy przez parametr `redirect` w adresie logowania / callbacku, tak aby po hydracji sesji wrócić na podgląd karty.

4. **Zweryfikować link „Podgląd karty”**
   - Upewnić się, że przycisk nadal używa trasy `/projects/$id/products/$pid/preview`, `params={{ id, pid }}` i `target="_blank"`.
   - Nie zmieniać samego szablonu karty produktu, bo widok już istnieje; problemem jest gubienie adresu przez auth redirect.

5. **Weryfikacja po zmianie**
   - Sprawdzić ścieżkę: klik w „Podgląd karty” → nowa karta → jeśli trzeba logowanie → powrót dokładnie do `/projects/{id}/products/{pid}/preview`.
   - Sprawdzić, że zwykłe wejście na `/login` nadal po zalogowaniu prowadzi do listy projektów.