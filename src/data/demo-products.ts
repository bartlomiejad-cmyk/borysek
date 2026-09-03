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

export type ProductIcon = "trash" | "droplets" | "wrench";

export type ShowcaseProduct = {
  id: string;
  name: string;
  industry: string;
  icon: ProductIcon;
  before: { values: Record<string, string>; image: boolean };
  after: { values: Record<string, string>; image: boolean };
  copy: { seoTitle: string; description: string };
};

/* 1. Chemia gospodarcza */

export const tigroValues: Record<string, string> = {
  Nazwa: "Tigro Worki na śmieci LDPE 120 l 25 szt. czarne mocne",
  EAN: "5906154012072",
  Kategoria: "Worki na śmieci",
  Cechy: "6 cech",
  Opis:
    "Worki na śmieci Tigro o pojemności 120 litrów wykonane zostały z elastycznej folii LDPE w kolorze czarnym. Produkt charakteryzuje się podwyższoną wytrzymałością, co pozwala na bezpieczne składowanie i transportowanie odpadów.",
  "Tytuł SEO": "Worki na śmieci Tigro LDPE 120 l, 25 szt., czarne",
  "Opis SEO":
    "Worki na śmieci Tigro LDPE 120 l, 25 sztuk, czarne, wymiary 70 x 110 cm, podwyższona wytrzymałość.",
  "Słowa kluczowe": "worki na śmieci 120 l, worki LDPE, Tigro",
  Packshot: "białe tło",
  "Opis Allegro":
    "Worki na śmieci Tigro 120 l z folii LDPE, 25 sztuk w rolce, wymiary 70 x 110 cm, kolor czarny.",
};

export const tigroFeatures: Array<[string, string]> = [
  ["Marka", "Tigro"],
  ["Pojemność", "120 l"],
  ["Materiał", "LDPE"],
  ["Kolor", "czarny"],
  ["Wymiary", "70 x 110 cm"],
  ["Liczba sztuk", "25"],
];

/* 2. Kosmetyki */

export const palmoliveValues: Record<string, string> = {
  Nazwa: "Palmolive Joyful Blooming Mydło w płynie 300 ml",
  EAN: "8718951378353",
  Kategoria: "Mydła w płynie",
  Cechy: "4 cechy",
  Opis:
    "Palmolive Joyful Blooming to mydło w płynie przeznaczone do codziennej higieny rąk. Produkt charakteryzuje się delikatną formułą myjącą, która skutecznie usuwa zanieczyszczenia z powierzchni skóry.",
  "Tytuł SEO": "Palmolive Joyful Blooming mydło w płynie 300 ml z dozownikiem",
  "Opis SEO":
    "Mydło w płynie Palmolive Joyful Blooming 300 ml w opakowaniu z dozownikiem, do codziennej higieny rąk.",
  "Słowa kluczowe": "mydło w płynie 300 ml, Palmolive, mydło z dozownikiem",
  Packshot: "białe tło",
  "Opis Allegro":
    "Palmolive Joyful Blooming mydło w płynie 300 ml, opakowanie z dozownikiem, delikatna formuła myjąca.",
};

/* 3. Części motocyklowe */

export const athenaValues: Record<string, string> = {
  Nazwa: "Wydech Athena Racing Pro Minarelli leżące P400485120012",
  EAN: "P400485120012",
  Kategoria: "Układy wydechowe",
  Cechy: "6 cech",
  Opis:
    "Wydech Athena Racing Pro to pełny układ wydechowy typu 1-into-1, zaprojektowany z myślą o skuterach wyposażonych w silnik Minarelli leżący. Konstrukcja wykonana z tytanu zapewnia redukcję masy oraz poprawę osiągów pojazdu.",
  "Tytuł SEO": "Wydech Athena Racing Pro do silników Minarelli leżących",
  "Opis SEO":
    "Tytanowy układ wydechowy Athena Racing Pro 1-into-1 do silników Minarelli leżących, kod producenta P400485120012.",
  "Słowa kluczowe": "wydech Athena Racing Pro, Minarelli leżące, P400485120012",
  Packshot: "białe tło",
  "Opis Allegro":
    "Pełny układ wydechowy Athena Racing Pro 1-into-1, tytan, do silników Minarelli leżących, kod P400485120012.",
};

export const athenaFeatures: Array<[string, string]> = [
  ["Marka", "Athena"],
  ["Model", "Racing Pro"],
  ["Materiał", "tytan"],
  ["Typ", "pełny układ 1-into-1"],
  ["Kod producenta", "P400485120012"],
  ["Kompatybilność", "8 modeli (Aprilia, Italjet, Malaguti, Yamaha)"],
];

export const showcaseProducts: ShowcaseProduct[] = [
  {
    id: "tigro-worki",
    name: "Worki na śmieci Tigro 120 l",
    industry: "Chemia gospodarcza",
    icon: "trash",
    before: {
      values: {
        Nazwa: "WORKI NA ŚMIECI TIGRO LDPE 120L A25 25SZT CZARNE BIO MOCNE",
        EAN: "5906154012072",
      },
      image: false,
    },
    after: { values: tigroValues, image: true },
    copy: {
      seoTitle: tigroValues["Tytuł SEO"]!,
      description: tigroValues["Opis"]!,
    },
  },
  {
    id: "palmolive-mydlo",
    name: "Palmolive Joyful Blooming 300 ml",
    industry: "Kosmetyki",
    icon: "droplets",
    before: {
      values: {
        Nazwa: "Palmolive Joyful Blooming Mydło w Płynie 300ml",
        EAN: "8718951378353",
      },
      image: false,
    },
    after: { values: palmoliveValues, image: true },
    copy: {
      seoTitle: palmoliveValues["Tytuł SEO"]!,
      description: palmoliveValues["Opis"]!,
    },
  },
  {
    id: "athena-wydech",
    name: "Wydech Athena Racing Pro",
    industry: "Części motocyklowe",
    icon: "wrench",
    before: {
      values: {
        Nazwa: "Wydech Athena Racing Pro, Minarelli leżące P400485120012",
        EAN: "P400485120012",
      },
      image: false,
    },
    after: { values: athenaValues, image: true },
    copy: {
      seoTitle: athenaValues["Tytuł SEO"]!,
      description: athenaValues["Opis"]!,
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
    value: i < filledCount ? tigroValues[label] : undefined,
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
