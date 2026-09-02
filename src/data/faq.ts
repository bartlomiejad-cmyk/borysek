export type FaqItem = { id: string; question: string; answer: string };

export const faqItems: FaqItem[] = [
  {
    id: "zgoda",
    question: "Czy coś trafi do mojego sklepu bez mojej zgody?",
    answer:
      "Nie. Dostajesz wszystkie karty do akceptacji w podglądzie lub arkuszu. Publikujemy tylko to, co zatwierdzisz.",
  },
  {
    id: "start",
    question: "Czego potrzebujecie ode mnie na start?",
    answer:
      "Dostępu do panelu sklepu albo eksportu produktów (CSV lub XML) i krótkiej rozmowy o tonie marki. Resztę robimy my.",
  },
  {
    id: "powtarzalnosc",
    question: "Czy opisy będą się powtarzać między produktami?",
    answer:
      "Nie. Każdy opis powstaje z danych konkretnego produktu i słownika Twojej marki, a redaktor sprawdza każdą kartę osobno.",
  },
  {
    id: "czas",
    question: "Ile to trwa?",
    answer:
      "Próbka 5 produktów: do 2 dni roboczych. Pełne wdrożenie zależy od liczby produktów; przy kilkuset produktach zwykle [LICZBA] dni.",
  },
  {
    id: "dostep",
    question: "Jak dbacie o dostęp do mojego sklepu?",
    answer:
      "Prosimy o osobne konto z minimalnymi uprawnieniami. Dane dostępowe przechowujemy zaszyfrowane i usuwamy po zakończeniu prac.",
  },
  {
    id: "probka",
    question: "Czy próbka do czegoś zobowiązuje?",
    answer: "Nie. Dostajesz 5 gotowych kart i decydujesz, czy chcesz kontynuować.",
  },
];
