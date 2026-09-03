import { Armchair, Coffee, Headphones, type LucideIcon } from "lucide-react";

export type FieldStatus = "empty" | "ai" | "verified";

export type ProductField = {
  label: string;
  value?: string;
  status: FieldStatus;
  long?: boolean;
};

export const FIELD_ORDER = [
  "Nazwa",
  "EAN",
  "Kategoria",
  "Cechy",
  "Opis",
  "Tytuł SEO",
  "Opis SEO",
  "Słowa kluczowe",
  "Packshot",
  "Opis Allegro",
] as const;

export type FieldLabel = (typeof FIELD_ORDER)[number];

export const LONG_FIELDS = new Set<string>(["Opis", "Opis SEO", "Opis Allegro"]);

export type ShowcaseProduct = {
  id: string;
  name: string;
  industry: string;
  icon: LucideIcon;
  before: { values: Record<string, string>; image: boolean };
  after: { values: Record<string, string>; image: boolean };
  copy: { seoTitle: string; description: string };
};

/* 1. Ekspres do kawy (hero, flow) */

export const espressoValues: Record<string, string> = {
  Nazwa: "Ekspres ciśnieniowy automatyczny 15 bar, 1,8 l, czarny",
  EAN: "5901234123457",
  Kategoria: "Ekspresy do kawy",
  Cechy: "6 cech",
  Opis:
    "Automatyczny ekspres ciśnieniowy przygotowuje espresso, cappuccino i latte jednym przyciskiem. Ceramiczny młynek stożkowy mieli ziarna bezpośrednio przed parzeniem, a ciśnienie 15 bar wydobywa pełny aromat kawy.",
  "Tytuł SEO": "Ekspres ciśnieniowy automatyczny 15 bar z młynkiem, 1,8 l",
  "Opis SEO":
    "Automatyczny ekspres ciśnieniowy 15 bar z ceramicznym młynkiem i spieniaczem mleka. Zbiornik 1,8 l, czarna obudowa, kawa jednym przyciskiem.",
  "Słowa kluczowe": "ekspres automatyczny, ekspres ciśnieniowy 15 bar, ekspres z młynkiem",
  Packshot: "białe tło",
  "Opis Allegro":
    "Ekspres ciśnieniowy automatyczny 15 bar, zbiornik 1,8 l, ceramiczny młynek stożkowy, automatyczny spieniacz mleka, kolor czarny.",
};

export const espressoFeatures: Array<[string, string]> = [
  ["Typ", "automatyczny"],
  ["Ciśnienie", "15 bar"],
  ["Zbiornik na wodę", "1,8 l"],
  ["Młynek", "ceramiczny, stożkowy"],
  ["Spieniacz", "automatyczny"],
  ["Kolor", "czarny"],
];

/* 2. Słuchawki */

export const headphonesValues: Record<string, string> = {
  Nazwa: "Słuchawki bezprzewodowe nauszne z ANC, 40 h pracy, grafitowe",
  EAN: "5901234123464",
  Kategoria: "Słuchawki bezprzewodowe",
  Cechy: "6 cech",
  Opis:
    "Nauszne słuchawki bezprzewodowe z aktywną redukcją szumów izolują od hałasu otoczenia w podróży i w biurze. Akumulator wystarcza na 40 godzin słuchania, a składana konstrukcja mieści się w dołączonym etui.",
  "Tytuł SEO": "Słuchawki bezprzewodowe nauszne ANC, 40 h, Bluetooth 5.3",
  "Opis SEO":
    "Nauszne słuchawki bezprzewodowe z aktywną redukcją szumów i 40 godzinami pracy. Bluetooth 5.3, ładowanie USB-C, składana konstrukcja.",
  "Słowa kluczowe": "słuchawki ANC, słuchawki bezprzewodowe nauszne, słuchawki bluetooth 40h",
  Packshot: "białe tło",
  "Opis Allegro":
    "Nauszne słuchawki bezprzewodowe z aktywną redukcją szumów, do 40 h pracy, Bluetooth 5.3, ładowanie USB-C, kolor grafitowy.",
};

export const headphonesFeatures: Array<[string, string]> = [
  ["Konstrukcja", "nauszne, zamknięte"],
  ["Redukcja szumów", "aktywna (ANC)"],
  ["Czas pracy", "do 40 h"],
  ["Łączność", "Bluetooth 5.3"],
  ["Ładowanie", "USB-C"],
  ["Kolor", "grafitowy"],
];

/* 3. Fotel biurowy */

export const chairValues: Record<string, string> = {
  Nazwa: "Fotel biurowy ergonomiczny z siatki, podłokietniki 4D, szary",
  EAN: "5901234123471",
  Kategoria: "Fotele biurowe",
  Cechy: "6 cech",
  Opis:
    "Ergonomiczny fotel biurowy z oparciem z oddychającej siatki i regulowanym podparciem odcinka lędźwiowego. Mechanizm synchroniczny dopasowuje kąt oparcia do siedziska, a podłokietniki 4D ustawisz w czterech kierunkach.",
  "Tytuł SEO": "Fotel biurowy ergonomiczny siatkowy z podłokietnikami 4D",
  "Opis SEO":
    "Ergonomiczny fotel biurowy z siatkowym oparciem, podparciem lędźwi i podłokietnikami 4D. Mechanizm synchroniczny, obciążenie do 130 kg.",
  "Słowa kluczowe": "fotel ergonomiczny, fotel biurowy siatkowy, fotel z podłokietnikami 4D",
  Packshot: "białe tło",
  "Opis Allegro":
    "Ergonomiczny fotel biurowy z siatkowym oparciem, podłokietniki regulowane 4D, mechanizm synchroniczny, obciążenie do 130 kg, kolor szary.",
};

export const chairFeatures: Array<[string, string]> = [
  ["Oparcie", "siatka z podparciem lędźwi"],
  ["Podłokietniki", "regulowane 4D"],
  ["Mechanizm", "synchroniczny"],
  ["Regulacja wysokości", "siłownik gazowy"],
  ["Maks. obciążenie", "130 kg"],
  ["Kolor", "szary"],
];

export const showcaseProducts: ShowcaseProduct[] = [
  {
    id: "ekspres",
    name: "Ekspres ciśnieniowy automatyczny 15 bar",
    industry: "AGD",
    icon: Coffee,
    before: {
      values: {
        Nazwa: "EKSPRES CISNIENIOWY AUTOMAT 15BAR 1,8L CZARNY",
        EAN: "5901234123457",
      },
      image: false,
    },
    after: { values: espressoValues, image: true },
    copy: {
      seoTitle: espressoValues["Tytuł SEO"]!,
      description: espressoValues["Opis"]!,
    },
  },
  {
    id: "sluchawki",
    name: "Słuchawki bezprzewodowe nauszne z ANC",
    industry: "Elektronika",
    icon: Headphones,
    before: {
      values: {
        Nazwa: "SLUCHAWKI BT ANC NAUSZNE 40H GRAFIT",
        EAN: "5901234123464",
      },
      image: false,
    },
    after: { values: headphonesValues, image: true },
    copy: {
      seoTitle: headphonesValues["Tytuł SEO"]!,
      description: headphonesValues["Opis"]!,
    },
  },
  {
    id: "fotel",
    name: "Fotel biurowy ergonomiczny z siatki",
    industry: "Meble biurowe",
    icon: Armchair,
    before: {
      values: {
        Nazwa: "FOTEL BIUROWY ERGO SIATKA PODLOKIETNIKI 4D SZARY",
        EAN: "5901234123471",
      },
      image: false,
    },
    after: { values: chairValues, image: true },
    copy: {
      seoTitle: chairValues["Tytuł SEO"]!,
      description: chairValues["Opis"]!,
    },
  },
];

/** Produkt pokazywany w hero i w sekcji „Jak pracujemy”. */
export const heroProduct = showcaseProducts[0]!;

export function fieldsFromValues(
  values: Record<string, string>,
  status: FieldStatus,
  visibleCount: number = FIELD_ORDER.length,
): ProductField[] {
  return FIELD_ORDER.map((label, i) => {
    const filled = values[label] !== undefined && i < visibleCount;
    return {
      label,
      long: LONG_FIELDS.has(label),
      value: filled ? values[label] : undefined,
      status: filled ? status : ("empty" as FieldStatus),
    };
  });
}

/** Buduje pola hero: pierwsze `filledCount` pól produktu 1 jest wypełnionych. */
export function buildFields(filledCount: number, status: FieldStatus = "ai"): ProductField[] {
  return FIELD_ORDER.map((label, i) => ({
    label,
    long: LONG_FIELDS.has(label),
    value: i < filledCount ? espressoValues[label] : undefined,
    status: i < filledCount ? status : ("empty" as FieldStatus),
  }));
}

export const navLinks = [
  { label: "Realizacje", href: "#cases" },
  { label: "Co dostajesz", href: "#scope" },
  { label: "Przed i po", href: "#before-after" },
  { label: "Jak pracujemy", href: "#flow" },
  { label: "Oferta", href: "#offer" },
  { label: "FAQ", href: "#faq" },
];

/** Pola karty w hero (wariant „wide"): 10 komórek w siatce 2 x 5. */
export type WideField = { label: string; value: string | null };

export const heroWideFields: WideField[] = [
  { label: "Nazwa", value: "Ekspres ciśnieniowy automatyczny" },
  { label: "EAN", value: "5901234123457" },
  { label: "Kategoria", value: "Ekspresy do kawy" },
  { label: "Cechy", value: "6 cech" },
  { label: "Opis", value: null },
  { label: "Tytuł SEO", value: "Ekspres 15 bar z młynkiem, 1,8 l" },
  { label: "Opis SEO", value: null },
  { label: "Frazy SEO", value: "ekspres automatyczny, 15 bar" },
  { label: "Packshot", value: "białe tło" },
  { label: "Allegro", value: null },
];
