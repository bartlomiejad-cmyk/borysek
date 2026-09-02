export type FieldStatus = "empty" | "ai" | "verified";

export type ProductField = {
  label: string;
  value?: string;
  status: FieldStatus;
  long?: boolean;
};

export const FIELD_ORDER = [
  "EAN",
  "Nazwa",
  "Kolor",
  "Materiał",
  "Kategoria",
  "Opis",
  "Tytuł SEO",
  "Opis SEO",
] as const;

export const ergoWatchValues: Record<string, string> = {
  EAN: "9921214440024",
  Nazwa: "Ergo Watch PRO",
  Kolor: "Czarny",
  Materiał: "Stal",
  Kategoria: "Smartwatche",
  Opis: "Smartwatch z pomiarem tętna i GPS",
  "Tytuł SEO": "Ergo Watch PRO — smartwatch ze stali",
  "Opis SEO": "Smartwatch Ergo Watch PRO: GPS, tętno, stal",
};

export const LONG_FIELDS = new Set(["Opis", "Opis SEO"]);

export function buildFields(filledCount: number, status: FieldStatus = "ai"): ProductField[] {
  return FIELD_ORDER.map((label, i) => ({
    label,
    long: LONG_FIELDS.has(label),
    value: i < filledCount ? ergoWatchValues[label] : undefined,
    status: i < filledCount ? status : ("empty" as FieldStatus),
  }));
}

export const emptyErgoWatch: ProductField[] = buildFields(0);
export const completeErgoWatch: ProductField[] = buildFields(FIELD_ORDER.length, "verified");

export const shopIntegrations = [
  { name: "Selly", available: true },
  { name: "Shoper", available: false },
  { name: "WooCommerce", available: false },
  { name: "BaseLinker", available: false },
  { name: "PrestaShop", available: false },
];

export const navLinks = [
  { label: "Jak działa", href: "#how" },
  { label: "Przed i po", href: "#before-after" },
  { label: "Proces", href: "#flow" },
  { label: "Integracje", href: "#integrations" },
  { label: "Cennik", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];
