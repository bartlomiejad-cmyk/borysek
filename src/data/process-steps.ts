import { FIELD_ORDER, LONG_FIELDS, ergoWatchValues, type FieldStatus, type ProductField } from "./demo-products";

export type ProcessImage = "none" | "product" | "lifestyle";
export type SegmentTone = "accent" | "amber" | "publish";

export type ProcessStep = {
  id: string;
  index: number;
  cardTitle: string;
  badge?: { text: string; variant: "accent" | "amber" | "neutral" };
  image: ProcessImage;
  completeness: number;
  highlight: "accent" | "amber" | "none";
  /** Field status per field label; missing = empty. */
  statuses: Partial<Record<(typeof FIELD_ORDER)[number], FieldStatus>>;
  person?: { name: string; role: string; initials: string };
  tone: SegmentTone;
  caption: string;
  description: string;
};

const BASE: Partial<Record<(typeof FIELD_ORDER)[number], FieldStatus>> = {
  EAN: "verified",
  Nazwa: "verified",
};

const WITH_PARAMS = { ...BASE, Kolor: "ai", Materiał: "ai", Kategoria: "ai" } as const;

const WITH_COPY = {
  ...WITH_PARAMS,
  Opis: "ai",
  "Tytuł SEO": "ai",
  "Opis SEO": "ai",
} as const;

const ALL_VERIFIED = Object.fromEntries(
  FIELD_ORDER.map((label) => [label, "verified" as FieldStatus]),
) as Partial<Record<(typeof FIELD_ORDER)[number], FieldStatus>>;

export const processSteps: ProcessStep[] = [
  {
    id: "new",
    index: 1,
    cardTitle: "Nowy",
    image: "none",
    completeness: 10,
    highlight: "none",
    statuses: BASE,
    tone: "accent",
    caption: "Start",
    description: "Dostajemy dostęp do sklepu lub plik z produktami",
  },
  {
    id: "access",
    index: 2,
    cardTitle: "Dostęp",
    badge: { text: "AI", variant: "accent" },
    image: "product",
    completeness: 28,
    highlight: "none",
    statuses: BASE,
    tone: "accent",
    caption: "DANE I ŹRÓDŁA",
    description: "Pobieramy Twoje dane i znajdujemy w internecie zweryfikowane źródła (zgodność EAN)",
  },
  {
    id: "params",
    index: 3,
    cardTitle: "Parametry",
    badge: { text: "AI", variant: "accent" },
    image: "product",
    completeness: 52,
    highlight: "none",
    statuses: WITH_PARAMS,
    tone: "accent",
    caption: "Parametry",
    description: "AI uzupełnia podstawowe parametry",
  },
  {
    id: "copy",
    index: 4,
    cardTitle: "Opis i SEO",
    badge: { text: "AI", variant: "accent" },
    image: "product",
    completeness: 80,
    highlight: "none",
    statuses: WITH_COPY,
    tone: "accent",
    caption: "Opis i SEO",
    description: "AI pisze opis i treści SEO",
  },
  {
    id: "review",
    index: 5,
    cardTitle: "Nasza weryfikacja",
    badge: { text: "Nasz zespół", variant: "amber" },
    image: "product",
    completeness: 80,
    highlight: "amber",
    statuses: WITH_COPY,
    person: { name: "[IMIĘ]", role: "Redaktor, nasz zespół", initials: "NZ" },
    tone: "amber",
    caption: "Weryfikacja",
    description: "Nasz redaktor sprawdza i poprawia każdą kartę",
  },
  {
    id: "photos",
    index: 6,
    cardTitle: "Zdjęcia",
    badge: { text: "na życzenie", variant: "neutral" },
    image: "lifestyle",
    completeness: 100,
    highlight: "none",
    statuses: WITH_COPY,
    tone: "accent",
    caption: "Zdjęcia",
    description: "Zdjęcia lifestyle, jeśli zamówisz",
  },
  {
    id: "approval",
    index: 7,
    cardTitle: "Twoja akceptacja",
    badge: { text: "Klient", variant: "amber" },
    image: "product",
    completeness: 100,
    highlight: "amber",
    statuses: ALL_VERIFIED,
    person: { name: "Ty", role: "Właściciel sklepu", initials: "TY" },
    tone: "amber",
    caption: "Akceptacja",
    description: "Akceptujesz karty w podglądzie lub arkuszu",
  },
  {
    id: "published",
    index: 8,
    cardTitle: "W Twoim sklepie",
    badge: { text: "Opublikowano", variant: "accent" },
    image: "product",
    completeness: 100,
    highlight: "accent",
    statuses: ALL_VERIFIED,
    tone: "publish",
    caption: "Publikacja",
    description: "Publikujemy w Twoim sklepie przez API lub oddajemy plik",
  },
];

export function buildStepFields(step: ProcessStep): ProductField[] {
  return FIELD_ORDER.map((label) => {
    const status = step.statuses[label] ?? ("empty" as FieldStatus);
    return {
      label,
      long: LONG_FIELDS.has(label),
      value: status === "empty" ? undefined : ergoWatchValues[label],
      status,
    };
  });
}
