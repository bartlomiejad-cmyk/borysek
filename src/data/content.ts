/** Treści sekcji: FAQ, oferta, platformy. */

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

export type OfferPackage = {
  id: string;
  name: string;
  caption: string;
  price: string | null;
  priceLabel: string | null;
  features: string[];
  cta: string;
  variant: "start" | "shop" | "catalog";
  featured?: boolean;
  /** Kolejność na mobile — pakiet Sklep pokazujemy jako pierwszy. */
  mobileOrder: number;
};

export const offerPackages: OfferPackage[] = [
  {
    id: "start",
    name: "Start",
    caption: "do 100 produktów",
    price: "[CENA] zł",
    priceLabel: "za produkt",
    features: [
      "nazwa, opis, cechy, kategoria, packshot na białym tle",
      "tytuł i opis SEO",
      "weryfikacja przez redaktora",
      "publikacja przez API lub plik",
    ],
    cta: "Zamów próbkę",
    variant: "start",
    mobileOrder: 2,
  },
  {
    id: "shop",
    name: "Sklep",
    caption: "100 do 1 000 produktów",
    price: "[CENA] zł",
    priceLabel: "za produkt",
    features: [
      "wszystko z pakietu Start",
      "ton marki i słownik branżowy",
      "warianty produktów",
      "opis Allegro",
      "drugi język w cenie",
    ],
    cta: "Zamów próbkę",
    variant: "shop",
    featured: true,
    mobileOrder: 1,
  },
  {
    id: "catalog",
    name: "Katalog",
    caption: "ponad 1 000 produktów",
    price: null,
    priceLabel: null,
    features: [
      "wszystko z pakietu Sklep",
      "harmonogram partiami",
      "zdjęcia aranżacyjne",
      "stała opieka nad nowościami",
    ],
    cta: "Umów rozmowę",
    variant: "catalog",
    mobileOrder: 3,
  },
];

export type Platform = { name: string; mode: "api" | "file" };

export const platforms: Platform[] = [
  { name: "Selly", mode: "api" },
  { name: "Shoper", mode: "file" },
  { name: "WooCommerce", mode: "file" },
  { name: "BaseLinker", mode: "file" },
  { name: "PrestaShop", mode: "file" },
  { name: "Shopify", mode: "file" },
];
