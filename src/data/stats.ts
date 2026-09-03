/** Fakty o procesie pokazywane w pasku pod hero (bez animacji licznika). */
export type LandingStat = {
  /** Number to animate, or a plain string shown as-is. */
  value: number | string;
  suffix?: string;
  text: string;
};

export const landingStats: LandingStat[] = [
  { value: "2-3", text: "zweryfikowane źródła na każdy produkt" },
  { value: "10", text: "elementów kompletnej karty produktu" },
  { value: "5", text: "produktów w bezpłatnej próbce" },
  { value: "2 dni", text: "robocze na przygotowanie próbki" },
];
