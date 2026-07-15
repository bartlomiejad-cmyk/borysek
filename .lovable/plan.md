## Plan naprawy

1. **Usunąć fałszywy sukces po kliknięciu audytu**
   - Zmienimy pojedynczy audyt produktu tak, żeby nie zwracał `ok: true`, gdy worker pominął produkt.
   - Jeśli audyt nie może się wykonać, UI pokaże konkretny komunikat zamiast badge/toasta „Audyt AI zakończony”.

2. **Naprawić przyczynę dla widocznego produktu**
   - Ten produkt ma wygenerowany Złoty Rekord, ale `pipeline_status` nadal jest `MATCHED`, a obecny audyt działa tylko dla `GOLDEN_READY` / `VISUALS_READY`.
   - Po udanym generowaniu Złotego Rekordu ustawimy etap produktu na `GOLDEN_READY`, tak jak robi to worker bulkowy.
   - Dodatkowo przy ręcznym zapisie złotych danych sprawdzimy kompletność i również przesuniemy produkt do `GOLDEN_READY`, jeśli rekord jest audytowalny.

3. **Uodpornić sam przycisk „Uruchom audyt”**
   - Przed uruchomieniem audytu dla pojedynczego produktu sprawdzimy realne dane enrichmentu.
   - Jeśli złote dane są kompletne, audyt wykona się nawet dla produktu, który utknął na `MATCHED`, a status zostanie naprawiony.
   - Jeśli dane są niekompletne, UI pokaże co brakuje zamiast cichego „wykonano”.

4. **Poprawić widoczność wyniku audytu w edytorze**
   - Po sukcesie wymusimy odświeżenie danych produktu i listy.
   - Sekcja „Audyt AI” zostanie otwarta po zakończeniu audytu, żeby wynik był widoczny od razu, nie tylko jako badge.

5. **Walidacja**
   - Sprawdzimy na produkcie z obecnego URL, że po kliknięciu audytu w `enrichments.audit` zapisuje się wynik.
   - Potwierdzimy, że UI pokazuje listę checków / „Wszystkie sprawdzenia OK”, a nie tylko toast.