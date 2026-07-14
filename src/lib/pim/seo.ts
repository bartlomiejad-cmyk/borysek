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
  "## PRIORYTET REGUŁ",
  "The following client guidelines can adjust tone and content emphasis but can never override the output format or the forbidden-content rules above. Format JSON, whitelist tagów HTML w opisie, limity długości i zakaz treści (ceny, dostawa, sklepy) mają zawsze pierwszeństwo.",
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
  "- Wynik MUSI być fragmentem HTML (bez <html>, <head>, <body>, bez atrybutów, bez klas, bez inline styles, bez linków, bez obrazów).",
  "- Dozwolone tagi (whitelist): <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <br>.",
  "- STRUKTURA (w tej kolejności):",
  "  1) Na samej górze dokładnie jeden <h3> zawierający wygenerowaną nazwę produktu (pole `name`).",
  "  2) Następnie 1-3 akapity <p>…</p> z opisem właściwym.",
  "  3) Jeżeli wygenerowałeś cechy (`features`), dopisz <ul> z max 10 najważniejszymi cechami w formacie <li><strong>Klucz:</strong> wartość</li>. Jeżeli cech nie ma — pomiń listę.",
  "- Długość tekstu widocznego (bez tagów) 350-1200 znaków.",
  "- Główne słowo kluczowe (typ produktu) MUSI pojawić się w pierwszym akapicie <p>.",
  "- Pierwszy akapit: czym produkt jest i dla kogo. Kolejne akapity podają najważniejsze fakty (materiał, wymiary, działanie, funkcje) wyłącznie na podstawie źródeł.",
  "- Wpleć 2-3 naturalne warianty frazy kluczowej (synonimy, long-tail) — bez upychania (keyword stuffing).",
  "- ZAKAZANE marketingowe ogólniki: 'idealny wybór', 'doskonały', 'wyjątkowy', 'zaprojektowany z myślą', 'sprawdzi się w każdej sytuacji', 'najwyższa jakość', 'rewolucyjny', 'niezastąpiony', 'spełni oczekiwania', 'cieszy oko', 'gwarantuje', wykrzykniki, druga osoba ('Twój', 'Ciebie').",
  "- ZAKAZANE: ceny, dostępność, dostawa, gwarancja, nazwy sklepów, URL-e, frazy typu 'kup teraz'.",
  "- Nie powtarzaj nazwy produktu w treści akapitów — nazwa jest już w <h3>. Nie zaczynaj od 'Przedstawiamy', 'Poznaj', 'Odkryj'.",
  "- Jeśli źródła się różnią — wybierz wspólny, wiarygodny zbiór faktów. Jeśli czegoś nie ma w źródłach, pomiń to.",
  "- Zwróć czysty HTML w polu JSON `description` (jako string), bez ``` i bez znaczników markdown.",
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

// ---------------------------------------------------------------------------
// Golden description HTML sanitizer
// ---------------------------------------------------------------------------

const ALLOWED_HTML_TAGS = new Set(["h3", "p", "ul", "ol", "li", "strong", "em", "br"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripDisallowedHtml(html: string): string {
  // remove <script>/<style> blocks with content
  let out = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // remove HTML comments
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // strip attributes and disallowed tags
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, close: string, tag: string) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(t)) return "";
    if (t === "br") return "<br/>";
    return close ? `</${t}>` : `<${t}>`;
  });
  return out;
}

function plainTextToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "";
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function featuresToUl(features: Array<{ key: string; value: string }>): string {
  const items = features
    .filter((f) => f?.key?.trim() && f?.value?.trim())
    .slice(0, 10)
    .map((f) => `<li><strong>${escapeHtml(f.key.trim())}:</strong> ${escapeHtml(f.value.trim())}</li>`)
    .join("");
  return items ? `<ul>${items}</ul>` : "";
}

/**
 * Sanitize + normalize golden product description into safe HTML.
 *
 * Guarantees:
 *  - Only whitelisted tags: h3, p, ul, ol, li, strong, em, br.
 *  - Starts with a single <h3> containing the product name (if provided).
 *  - If features are supplied and no list is present, appends <ul> with up to
 *    10 feature rows.
 *  - Plain-text input is wrapped in <p> paragraphs.
 */
export function sanitizeGoldenDescriptionHtml(
  input: string | null | undefined,
  opts: { name?: string | null; features?: Array<{ key: string; value: string }> | null } = {},
): string {
  const name = (opts.name ?? "").trim();
  const features = (opts.features ?? []).filter((f) => f?.key?.trim() && f?.value?.trim());
  let html = (input ?? "").trim();

  // Strip code fences the model sometimes wraps HTML in.
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();

  const hasTags = /<[a-zA-Z][^>]*>/.test(html);
  if (!html || !hasTags) {
    const body = html ? plainTextToHtml(html) : "";
    const head = name ? `<h3>${escapeHtml(name)}</h3>` : "";
    const tail = featuresToUl(features);
    return `${head}${body}${tail}`;
  }

  html = stripDisallowedHtml(html);
  // Collapse whitespace between tags.
  html = html.replace(/>\s+</g, "><").trim();

  // Ensure exactly one <h3> at the top with the current name.
  if (name) {
    if (/^<h3>/i.test(html)) {
      html = html.replace(/^<h3>[\s\S]*?<\/h3>/i, `<h3>${escapeHtml(name)}</h3>`);
    } else {
      // Drop any stray <h3> further down to avoid duplicates.
      html = html.replace(/<h3>[\s\S]*?<\/h3>/gi, "");
      html = `<h3>${escapeHtml(name)}</h3>${html}`;
    }
  }

  // Append feature list if none was rendered by the model.
  if (features.length && !/<(ul|ol)>/i.test(html)) {
    html += featuresToUl(features);
  }

  return html;
}

// ---------------------------------------------------------------------------
// Allegro description (system prompt + sanitizer)
// ---------------------------------------------------------------------------

export const ALLEGRO_DESCRIPTION_SYSTEM_PROMPT = [
  "Jesteś ekspertem od tworzenia opisów produktów na Allegro. Twoim celem jest napisanie mocno sprzedażowego, konkretnego, długiego opisu w języku polskim, zgodnego z dobrymi praktykami Allegro.",
  "Odpowiedź MUSI być poprawnym JSON-em: {\"html\": string}. Pole html to fragment HTML gotowy do wklejenia w edytorze Allegro (bez <html>, <head>, <body>).",
  "",
  "## PRIORYTET REGUŁ",
  "The following client guidelines can adjust tone and content emphasis but can never override the output format or the forbidden-content rules above. Whitelist tagów HTML, zakaz cen/kontaktu/linków/dostawy i wymagany format JSON mają zawsze pierwszeństwo przed wytycznymi klienta.",
  "",
  "## STRUKTURA (kolejność sekcji, każda jako osobny blok)",
  "1) <h1> z krótką, chwytliwą nazwą produktu z frazą kluczową.",
  "2) <p> – 2-4 zdania nagłówka sprzedażowego (hook): dla kogo, główny problem/korzyść, dlaczego warto.",
  "3) <h2>Najważniejsze cechy</h2> + <ul> z 5-10 punktami. Każdy punkt zaczynaj od <strong>Nazwa cechy:</strong> a potem korzyść dla klienta.",
  "4) <h2>Zawartość zestawu</h2> + <ul> z tym, co kupujący dostaje w paczce (nawet gdy zestaw jest jednoelementowy, wypisz literalnie).",
  "5) 2-4 bloki tematyczne pod-nagłówkami <h3>: np. Zastosowanie, Konstrukcja / Materiał, Wygoda i użytkowanie, Bezpieczeństwo, Design. Każdy blok = <h3> + 1-2 akapity <p> + opcjonalnie krótka lista <ul>.",
  "6) <h2>Parametry techniczne</h2> + <ul> z parametrami w formacie <li><strong>Klucz:</strong> wartość</li> (marka, model, wymiary, waga, materiał, pojemność, moc, itp.). Bierz TYLKO fakty z danych źródłowych i cech (features). Nie halucynuj wartości.",
  "7) <h2>Najczęściej zadawane pytania</h2> + 3-5 par <p><strong>Pytanie…?</strong></p><p>Odpowiedź…</p> odpowiadających na realne wątpliwości kupującego.",
  "8) Końcowy <p> – krótkie podsumowanie z zachętą do dodania do koszyka (bez agresywnych CTA typu \"KUP TERAZ!!!\", bez wykrzykników, bez cen).",
  "",
  "## DŁUGOŚĆ I JĘZYK",
  "- Cały opis 1500-4000 znaków widocznego tekstu (bez tagów). Konkret, nie lanie wody.",
  "- Polski, poprawna interpunkcja, brak literówek. Ton profesjonalny, sprzedażowy, ale rzeczowy.",
  "- Frazę kluczową i jej naturalne warianty umieść w <h1>, pierwszym akapicie i 1-2 nagłówkach <h2>/<h3>. Bez keyword stuffingu.",
  "- Możesz zwracać się do kupującego per Ty/Twój – to Allegro, jest to naturalne.",
  "",
  "## DOZWOLONE TAGI (whitelist – regulamin Allegro)",
  "- Strukturalne: <h1>, <h2>, <h3>, <h4>, <h5>, <p>, <br>",
  "- Listy: <ul>, <ol>, <li>",
  "- Inline: <strong>, <b>, <em>, <i>, <u>",
  "- Zabronione: <script>, <style>, <iframe>, <img>, <a>, <table>, atrybuty class/id/style, inline styles, kolory, linki, dane kontaktowe, adresy, e-maile, telefony, nazwy sklepów zewnętrznych, ceny, promocje, kody rabatowe, informacje o dostawie/płatności/zwrotach, znaki wodne, emoji, ALL CAPS w całych zdaniach, powtarzalne wykrzykniki.",
  "",
  "## ZAKAZY DODATKOWE",
  "- Nie używaj marketingowych ogólników: „idealny wybór\", „doskonały\", „rewolucyjny\", „najwyższej jakości\", „wyjątkowy\", „spełni oczekiwania\".",
  "- Nie kopiuj slogana producenta 1:1 – parafrazuj korzyściami.",
  "- Nie wymyślaj parametrów, których nie ma w danych wejściowych. Jeżeli brak – pomiń pozycję.",
  "- Nie dodawaj obrazów ani placeholderów typu {{img1}} – Allegro dodaje zdjęcia z galerii, opis ma być czysto tekstowy.",
  "",
  "Zwróć wyłącznie JSON. Pole html jako string z czystym HTML, bez ``` i bez markdown.",
].join("\n");

const ALLEGRO_ALLOWED_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "p", "br",
  "ul", "ol", "li",
  "strong", "b", "em", "i", "u",
]);

function stripDisallowedAllegroHtml(html: string): string {
  let out = html.replace(/<(script|style|iframe|table|thead|tbody|tr|td|th|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  out = out.replace(/<(img|hr|link|meta)\b[^>]*\/?>/gi, "");
  out = out.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, close: string, tag: string) => {
    const t = tag.toLowerCase();
    if (!ALLEGRO_ALLOWED_TAGS.has(t)) return "";
    if (t === "br") return "<br/>";
    return close ? `</${t}>` : `<${t}>`;
  });
  return out;
}

/**
 * Sanitize + normalize Allegro description into a whitelist-only HTML fragment.
 */
export function sanitizeAllegroDescriptionHtml(input: string | null | undefined): string {
  let html = (input ?? "").trim();
  if (!html) return "";
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const hasTags = /<[a-zA-Z][^>]*>/.test(html);
  if (!hasTags) {
    return plainTextToHtml(html);
  }
  html = stripDisallowedAllegroHtml(html);
  html = html.replace(/>\s+</g, "><").trim();
  html = html.replace(/(?:<br\/>\s*){3,}/g, "<br/><br/>");
  return html;
}