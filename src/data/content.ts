/** Treści sekcji: kontakt, FAQ, oferta, platformy. */

/** Ustaw prawdziwe dane; placeholder w nawiasach kwadratowych nie jest renderowany. */
export const contactEmail = "[ADRES E-MAIL]";
export const contactPhone = "[TELEFON]";

/** True, gdy wartość jest prawdziwa, a nie placeholderem typu "[TELEFON]". */
export function isSet(value: string): boolean {
  return value.trim().length > 0 && !/^\[.*\]$/.test(value.trim());
}

export type FaqItem = { id: string; question: string; answer: string };

export const faqItems: FaqItem[] = [
  {
    id: "zgoda",
    question: "Czy coś trafi do mojego sklepu bez mojej zgody?",
    answer:
      "Nie. Dostajesz wszystkie karty do akceptacji w podglądzie lub arkuszu. Wgrywamy tylko to, co zatwierdzisz.",
  },
  {
    id: "start",
    question: "Czego potrzebujecie ode mnie na start?",
    answer:
      "Eksportu produktów ze sklepu (CSV lub XLSX) albo dostępu do panelu i krótkiej rozmowy o tonie marki. Resztę robimy my.",
  },
  {
    id: "zrodla",
    question: "Skąd bierzecie informacje o moich produktach? Czy AI ich nie zmyśli?",
    answer:
      "Nie zmyśli, bo nie ma skąd: dla każdego produktu znajdujemy w internecie strony producentów i sklepów opisujące dokładnie ten produkt i potwierdzamy zgodność po kodach EAN. Opis powstaje wyłącznie z tych zweryfikowanych źródeł, a redaktor sprawdza go przed oddaniem.",
  },
  {
    id: "zdjecia",
    question: "Co z moimi zdjęciami?",
    answer:
      "Twoje zdjęcia są nadrzędne i nigdy ich nie nadpisujemy. Tam, gdzie zdjęć brakuje, przygotowujemy packshoty na białym tle, a na życzenie także wizualizacje aranżacyjne. Jedne i drugie trafiają do Twojej akceptacji jak każda inna treść.",
  },
  {
    id: "powtarzalnosc",
    question: "Czy opisy będą się powtarzać między produktami?",
    answer:
      "Nie. Każdy opis powstaje z danych i źródeł konkretnego produktu oraz słownika Twojej marki, a redaktor sprawdza każdą kartę osobno.",
  },
  {
    id: "czas",
    question: "Ile to trwa?",
    answer:
      "Próbka 5 produktów: do 2 dni roboczych. Termin pełnego wdrożenia podajemy razem z wyceną, po próbce.",
  },
  {
    id: "dostep",
    question: "Jak dbacie o dostęp do mojego sklepu?",
    answer:
      "Wolimy pracować na eksporcie produktów. Jeśli dajesz nam dostęp do panelu, prosimy o osobne konto z minimalnymi uprawnieniami; usuwamy je po zakończeniu prac.",
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
  /** Null = brak ceny liczbowej; karta pokazuje tekst z priceNote. */
  price: string | null;
  priceLabel: string | null;
  priceNote: string;
  features: string[];
  cta: string;
  variant: "start" | "shop" | "catalog";
  featured?: boolean;
  /** Kolejność na mobile: pakiet Sklep pokazujemy jako pierwszy. */
  mobileOrder: number;
};

export const offerPackages: OfferPackage[] = [
  {
    id: "start",
    name: "Start",
    caption: "do 100 produktów",
    price: null,
    priceLabel: null,
    priceNote: "Wycena za produkt",
    features: [
      "nazwa, opis, cechy, kategoria, packshot na białym tle",
      "tytuł i opis SEO",
      "weryfikacja przez redaktora",
      "wgranie do sklepu w cenie (każda platforma)",
    ],
    cta: "Zamów próbkę",
    variant: "start",
    mobileOrder: 2,
  },
  {
    id: "shop",
    name: "Sklep",
    caption: "100 do 1 000 produktów",
    price: null,
    priceLabel: null,
    priceNote: "Wycena za produkt",
    features: [
      "wszystko z pakietu Start",
      "ton marki i słownik branżowy",
      "warianty produktów",
      "zdjęcia aranżacyjne",
      "opis Allegro",
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
    priceNote: "Wycena indywidualna",
    features: [
      "wszystko z pakietu Sklep",
      "harmonogram partiami",
      "priorytetowa kolejka realizacji",
      "stała opieka nad nowościami",
    ],
    cta: "Umów rozmowę",
    variant: "catalog",
    mobileOrder: 3,
  },
];

export type Platform = { name: string; mode: "upload" | "file" };

export const platforms: Platform[] = [
  { name: "Selly", mode: "upload" },
  { name: "Shoper", mode: "file" },
  { name: "WooCommerce", mode: "file" },
  { name: "BaseLinker", mode: "file" },
  { name: "PrestaShop", mode: "file" },
  { name: "Shopify", mode: "file" },
];
