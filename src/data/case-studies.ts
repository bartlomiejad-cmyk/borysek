import { tigroValues } from "./demo-products";

/** Placeholders in square brackets are intentional: replace with real data only. */

/** Sekcja "Realizacje" jest ukryta, dopóki nie mamy prawdziwych danych. */
export const SHOW_CASE_STUDIES = false;

export type CaseProductState = {
  values: Record<string, string>;
  completeness: number;
  image: boolean;
};

export type CaseStudy = {
  id: string;
  client: string;
  industry: string;
  platform: string;
  productsCount: string;
  durationDays: string;
  scope: string[];
  result: string;
  quote?: { text: string; author: string; role: string };
  before: CaseProductState;
  after: CaseProductState;
};

function demoState(partial: boolean): CaseProductState {
  if (partial) {
    return {
      values: { EAN: tigroValues.EAN!, Nazwa: tigroValues.Nazwa! },
      completeness: 20,
      image: false,
    };
  }
  return { values: tigroValues, completeness: 100, image: true };
}

export const caseStudies: CaseStudy[] = [1, 2, 3].map((n) => ({
  id: `case-${n}`,
  client: `[KLIENT ${n}]`,
  industry: "[BRANŻA]",
  platform: "[PLATFORMA]",
  productsCount: "[LICZBA]",
  durationDays: "[LICZBA]",
  scope: [
    "Nazwy i opisy",
    "Cechy i kategorie",
    "Tytuły i opisy SEO",
    "Publikacja w sklepie",
  ],
  result: "[JEDNO ZDANIE O EFEKCIE]",
  quote: {
    text: "[CYTAT KLIENTA]",
    author: "[IMIĘ I NAZWISKO]",
    role: "[ROLA, FIRMA]",
  },
  before: demoState(true),
  after: demoState(false),
}));
