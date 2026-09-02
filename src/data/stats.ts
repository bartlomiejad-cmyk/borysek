/** Placeholders in square brackets are intentional — replace with real data only. */
export type LandingStat = {
  /** Number to animate, or a "[LICZBA]" style placeholder shown as-is. */
  value: number | string;
  suffix?: string;
  text: string;
};

export const landingStats: LandingStat[] = [
  { value: "[LICZBA]", text: "produktów opisanych dla klientów" },
  { value: "[LICZBA]", text: "sklepów, z którymi pracowaliśmy" },
  { value: "[LICZBA]", text: "branż: od elektroniki po kosmetyki" },
  { value: "[LICZBA]", suffix: " dni", text: "średnio od dostępu do publikacji" },
];
