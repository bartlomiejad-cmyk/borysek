// Client-safe SEO helpers shared between server functions and background workers.

const PL_DIACRITICS: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "a", Ć: "c", Ę: "e", Ł: "l", Ń: "n", Ó: "o", Ś: "s", Ź: "z", Ż: "z",
};
const SLUG_STOPWORDS = new Set([
  "i", "oraz", "lub", "albo", "a", "o", "u", "w", "we", "z", "ze", "do", "na", "po",
  "za", "od", "dla", "the", "and", "or", "of", "for",
]);

export function slugifyPl(input: string, maxLen = 75): string {
  if (!input) return "";
  let s = input;
  s = s.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => PL_DIACRITICS[c] ?? c);
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (!s) return "";
  const parts = s.split("-").filter((p) => p && !SLUG_STOPWORDS.has(p));
  let out = parts.length ? parts.join("-") : s;
  if (out.length > maxLen) {
    out = out.slice(0, maxLen);
    const lastDash = out.lastIndexOf("-");
    if (lastDash > maxLen * 0.6) out = out.slice(0, lastDash);
  }
  return out.replace(/^-+|-+$/g, "");
}

export function clampName(name: string, maxLen = 70): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

export function clampMetaDescription(desc: string, maxLen = 160): string {
  let s = desc.trim().replace(/\s+/g, " ").replace(/["„""]/g, "");
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  s = (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

export function dedupeKeywords(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of arr) {
    const norm = k.trim().toLowerCase().replace(/\s+/g, " ");
    if (!norm || norm.length < 2 || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 8) break;
  }
  return out;
}

export const GOLDEN_SEO_SYSTEM_PROMPT = [
  "Jesteś redaktorem katalogu e-commerce i specjalistą SEO. Tworzysz zoptymalizowane pod wyszukiwarki treści produktu na podstawie 1-3 źródeł internetowych.",
  'Odpowiedź MUSI być poprawnym JSON-em: {"name": string, "slug": string, "description": string, "meta_description": string, "seo_keywords": string[], "features": [{"key": string, "value": string}]}.',
  "Pisz po polsku, neutralnym językiem katalogowym. Konkret zamiast emocji.",
  "",
  "## NAZWA (name)",
  "- 40-70 znaków (optymalna długość pod <title>).",
  "- Format: [marka] [model lub typ produktu] [kluczowa cecha różnicująca]. Główne słowo kluczowe (typ produktu) w pierwszych 30 znakach.",
  "- Bez ALL CAPS, bez wykrzykników, bez znaków specjalnych poza myślnikiem.",
  "",
  "## SLUG (slug)",
  "- Kebab-case, tylko [a-z0-9-], max 75 znaków.",
  "- Bez polskich znaków diakrytycznych (ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź/ż→z).",
  "- Główne słowo kluczowe na początku. Pomijaj stop-words (i, oraz, dla, z, w, na) gdy nie zmieniają sensu.",
  "- Przykład: 'buty-trekkingowe-meskie-salomon-x-ultra-4'.",
  "",
  "## OPIS (description)",
  "- 350-900 znaków.",
  "- Główne słowo kluczowe (typ produktu) MUSI pojawić się w pierwszych 100 znakach.",
  "- Pierwsze zdanie: czym produkt jest i dla kogo. Kolejne zdania podają najważniejsze fakty (materiał, wymiary, działanie, funkcje) wyłącznie na podstawie źródeł.",
  "- Wpleć 2-3 naturalne warianty frazy kluczowej (synonimy, long-tail) — bez upychania (keyword stuffing).",
  "- Akapity 2-4 zdania (czytelność).",
  "- ZAKAZANE marketingowe ogólniki: 'idealny wybór', 'doskonały', 'wyjątkowy', 'zaprojektowany z myślą', 'sprawdzi się w każdej sytuacji', 'najwyższa jakość', 'rewolucyjny', 'niezastąpiony', 'spełni oczekiwania', 'cieszy oko', 'gwarantuje', wykrzykniki, druga osoba ('Twój', 'Ciebie').",
  "- ZAKAZANE: ceny, dostępność, dostawa, gwarancja, nazwy sklepów, URL-e, frazy typu 'kup teraz'.",
  "- Nie powtarzaj nazwy produktu więcej niż raz. Nie zaczynaj od 'Przedstawiamy', 'Poznaj', 'Odkryj'. Bez nagłówków, bez list w opisie.",
  "- Jeśli źródła się różnią — wybierz wspólny, wiarygodny zbiór faktów. Jeśli czegoś nie ma w źródłach, pomiń to.",
  "",
  "## META_DESCRIPTION (meta_description)",
  "- 150-160 znaków (twardy limit; odcięcie w Google ~160). Jedno-dwa zdania.",
  "- Streszczenie produktu + jedna konkretna korzyść/cecha + naturalna fraza kluczowa.",
  "- Bez cudzysłowów. Nie duplikuj pierwszego zdania opisu — meta ma być komplementarna, nie identyczna.",
  "- Bez CTA typu 'kup teraz', bez cen.",
  "",
  "## SEO_KEYWORDS (seo_keywords)",
  "- Tablica 3-8 fraz, wszystko lowercase.",
  "- 1 fraza główna (typ produktu), 2-3 średnie (typ + cecha, np. 'plecak trekkingowy 30l'), 2-4 long-tail (3-5 słów, intencja kupującego, np. 'plecak na jednodniowe wycieczki w góry').",
  "- Tylko frazy realnie wynikające ze źródeł i właściwości produktu — bez halucynacji marek.",
  "- Bez duplikatów, bez fraz jednowyrazowych poza nazwą kategorii.",
  "",
  "## FEATURES (features)",
  "- Lista konkretnych cech technicznych (max 60), klucz/wartość. Klucze po polsku, krótkie.",
  "- Preferowane klucze (gdy aplikowalne, dla spójności z schema.org/Product): Marka, Model, Materiał, Kolor, Wymiary, Waga, Pojemność, Moc, Zasilanie, Wydajność, Gwarancja, Kraj produkcji, EAN, Rozmiar, Płeć, Wiek, Przeznaczenie.",
  "- Wartości konkretne, bez przymiotników marketingowych.",
  "- Pomiń cechy nieobecne w źródłach. Pomiń ceny, dostępność, nazwy sklepów. Jeśli brak danych: [].",
].join("\n");