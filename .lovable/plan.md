Plan naprawy:

1. Poprawić samo czyszczenie źródeł
- Rozszerzyć filtr obrazów o placeholdery/banery wykrywane nie tylko po URL, ale też po już zapisanej ocenie AI (`is_banner_or_trash`).
- Przy czyszczeniu usuwać takie URL-e również z `images` i `extra_images`, nawet gdy nazwa pliku wygląda neutralnie.

2. Naprawić efekt „klikam i nic”
- Dodać stan ładowania przy przycisku `Wyczyść źródła`, żeby było widać, że akcja trwa.
- Po zakończeniu wymusić odświeżenie danych produktu i listy źródeł.
- Pokazać wynik także wtedy, gdy usunięto 0 elementów, ale operacja faktycznie się wykonała.

3. Ukryć pozostałości, które już są oznaczone jako śmieć
- W widoku produktu odfiltrować z galerii i sekcji źródeł zdjęcia, które mają `image_scores[URL].is_banner_or_trash === true`.
- Dzięki temu istniejące szare placeholdery/banery znikną z UI nawet jeśli nie da się ich jednoznacznie rozpoznać po samym URL.

4. Zweryfikować sygnały
- Sprawdzić po zmianie, czy klik generuje request do funkcji czyszczącej i czy widok produktu odświeża się bez ręcznego reloadu.