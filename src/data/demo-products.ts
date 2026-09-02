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

export type ShowcaseProduct = {
  id: string;
  name: string;
  icon: "watch" | "lamp" | "backpack";
  before: { values: Record<string, string>; completeness: number; image: boolean };
  after: { values: Record<string, string>; completeness: number; image: boolean };
  copy: { seoTitle: string; description: string };
};

const nordLampValues: Record<string, string> = {
  EAN: "5901234098761",
  Nazwa: "Lampa biurkowa Nord LED",
  Kolor: "Biały",
  Materiał: "Aluminium",
  Kategoria: "Oświetlenie biurowe",
  Opis: "Lampa LED z regulacją barwy światła",
  "Tytuł SEO": "Lampa biurkowa LED Nord z regulacją barwy",
  "Opis SEO": "Nord LED: trzy barwy światła i ściemnianie dotykowe",
};

const ventoBackpackValues: Record<string, string> = {
  EAN: "5903872110458",
  Nazwa: "Plecak miejski Vento 22L",
  Kolor: "Grafitowy",
  Materiał: "Poliester z recyklingu",
  Kategoria: "Plecaki",
  Opis: "Plecak 22 l z kieszenią na laptopa 16 cali",
  "Tytuł SEO": "Plecak miejski Vento 22 l na laptopa 16 cali",
  "Opis SEO": "Vento 22L: kieszeń na laptopa i pokrowiec przeciwdeszczowy",
};

function pick(values: Record<string, string>, labels: string[]): Record<string, string> {
  return Object.fromEntries(labels.map((l) => [l, values[l]!]));
}

export const showcaseProducts: ShowcaseProduct[] = [
  {
    id: "ergo-watch",
    name: "Ergo Watch PRO",
    icon: "watch",
    before: { values: pick(ergoWatchValues, ["EAN", "Nazwa"]), completeness: 28, image: false },
    after: { values: ergoWatchValues, completeness: 100, image: true },
    copy: {
      seoTitle: "Ergo Watch PRO — smartwatch ze stalową kopertą",
      description:
        "Ergo Watch PRO mierzy tętno przez całą dobę i pracuje do 10 dni na jednym ładowaniu. Stalowa koperta i wodoszczelność 5 ATM pozwalają nosić zegarek na basenie i w deszczu.",
    },
  },
  {
    id: "nord-lamp",
    name: "Lampa biurkowa Nord LED",
    icon: "lamp",
    before: {
      values: pick(nordLampValues, ["EAN", "Nazwa", "Kolor"]),
      completeness: 38,
      image: false,
    },
    after: { values: nordLampValues, completeness: 100, image: true },
    copy: {
      seoTitle: "Lampa biurkowa LED Nord z regulacją barwy światła",
      description:
        "Nord LED oferuje trzy barwy światła: ciepłą do wieczornej pracy, neutralną do biura i zimną do czytania. Dotykowy panel płynnie ściemnia lampę, a aluminiowe ramię utrzymuje ustawiony kąt.",
    },
  },
  {
    id: "vento-backpack",
    name: "Plecak miejski Vento 22L",
    icon: "backpack",
    before: { values: pick(ventoBackpackValues, ["EAN"]), completeness: 10, image: false },
    after: { values: ventoBackpackValues, completeness: 100, image: true },
    copy: {
      seoTitle: "Plecak miejski Vento 22 l na laptopa 16 cali",
      description:
        "Vento 22L ma wyściełaną kieszeń na laptopa do 16 cali i główną komorę na sprzęt oraz dokumenty. Tkanina powstaje z poliestru z recyklingu, a dołączony pokrowiec przeciwdeszczowy chroni zawartość w drodze.",
    },
  },
];

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
