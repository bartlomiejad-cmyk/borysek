## Cel
Naprawić sytuację, w której FAL generuje wizualizację, ale aplikacja nie dopisuje jej do produktu, więc nie widać jej ani na liście projektu, ani w karcie produktu.

## Ustalenia
- Ostatnie zadanie wizualizacji dla projektu `prime_sale` ma status `COMPLETED`, ale `processed_count = 0` i `ai_gallery_urls = []`.
- Log zadania urywa się po `wizualizacja 1/3…`, bez komunikatu sukcesu/błędu.
- To wskazuje na timeout workerów: FAL zdążył wygenerować obraz, ale backend kończy request zanim pobierze wynik, wgra go do storage i zapisze URL w `enrichments.ai_gallery_urls`.
- UI już czyta i pokazuje `ai_gallery_urls`, więc główna poprawka jest w przetwarzaniu zadania, nie w widoku.

## Plan zmian
1. **Dostosować worker wizualizacji do limitu czasu**
   - Przy `PIM_VISUALIZATIONS` przetwarzać bezpiecznie mniejsze porcje, tak aby request nie kończył się w połowie jednego renderu.
   - Dla jednego uruchomienia workera generować maksymalnie tyle obrazów, ile da się obsłużyć w limicie, a resztę zostawić w kolejce zamiast oznaczać zadanie jako zakończone.

2. **Zapisywać postęp po każdej udanej wizualizacji**
   - Po każdym wygenerowanym obrazie od razu wgrywać go do bucketu i dopisywać URL do `ai_gallery_urls`.
   - Dzięki temu nawet jeśli kolejna generacja przekroczy czas, już gotowe obrazy będą widoczne w produkcie.

3. **Naprawić błędny status zadań**
   - Zadanie nie może dostać `COMPLETED`, jeśli nie przetworzono produktu lub nie zapisano obrazów.
   - Jeśli worker przerwie przez limit czasu, zadanie ma zostać jako `PROCESSING/PENDING` z pozostałymi elementami, żeby kolejny cron/hook kontynuował.

4. **Dodać czytelny log diagnostyczny**
   - Logować: URL z FAL odebrany, upload do storage OK, dopisano do galerii.
   - W razie timeoutu/błędu log ma jasno pokazywać ostatni zakończony krok.

5. **Odświeżanie UI po zakończeniu**
   - Upewnić się, że po terminalnym stanie `PIM_VISUALIZATIONS` lista produktów i karta produktu odświeżają dane z `ai_gallery_urls`.

## Weryfikacja
- Uruchomić wizualizacje dla produktu z przykładu.
- Sprawdzić w bazie, że `enrichments.ai_gallery_urls` zawiera nowe URL-e.
- Sprawdzić w aplikacji, że licznik „Wizualizacje AI” pojawia się na liście, a sekcja „Wizualizacje AI” w karcie produktu pokazuje miniatury.