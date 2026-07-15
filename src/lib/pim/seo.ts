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

/**
 * Finalize a meta_description: return `raw` as-is if it already fits ≤160 chars.
 * If longer, ask the model once (via `shortenFn`) to compress it into the
 * 140-155 char target. As a last resort truncate to 157 chars + "…".
 *
 * The retry is the "programmatic meta_description validation" from the plan:
 * LLMs often overshoot the 160-char limit even when the prompt asks for it.
 */
export async function finalizeMetaDescription(
  raw: string,
  shortenFn?: (text: string) => Promise<string>,
): Promise<string> {
  const normalize = (s: string) =>
    s.trim().replace(/\s+/g, " ").replace(/["„""]/g, "");
  const cleaned = normalize(raw);
  if (cleaned.length <= 160) return cleaned;
  if (shortenFn) {
    try {
      const shortened = normalize(await shortenFn(cleaned));
      if (shortened && shortened.length <= 160) return shortened;
    } catch {
      /* fall through to hard truncate */
    }
  }
  const cut = cleaned.slice(0, 157);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > 100 ? cut.slice(0, lastSpace) : cut;
  return `${base.trim()}…`;
}

export const SHORTEN_META_SYSTEM_PROMPT =
  "Skróć podany meta_description do 140-155 znaków, po polsku, naturalnie, bez cudzysłowów, bez cen, bez CTA. Zwróć wyłącznie JSON: {\"meta_description\": string}.";

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

// ---------------------------------------------------------------------------
// Client guidelines block — injected into golden / Allegro / visualization
// prompts as a user-role addendum. Hard rules from the system prompt still win
// (see "PRIORYTET REGUŁ" section above).
// ---------------------------------------------------------------------------

export function buildClientGuidelinesBlock(
  guidelines: string | null | undefined,
  productNotes: string | null | undefined,
): string {
  const g = (guidelines ?? "").trim().slice(0, 2000);
  const n = (productNotes ?? "").trim().slice(0, 500);
  if (!g && !n) return "";
  const lines = [
    "WYTYCZNE KLIENTA (obowiązkowe, mają pierwszeństwo przed ogólnymi zasadami stylu, ale NIE mogą łamać wymagań formatu JSON ani whitelisty tagów HTML):",
  ];
  lines.push(g || "(brak wytycznych projektowych)");
  if (n) lines.push(`NOTATKI DO PRODUKTU: ${n}`);
  return lines.join("\n");
}

export const GOLDEN_SEO_SYSTEM_PROMPT = [
  "Jesteś redaktorem katalogu e-commerce i specjalistą SEO. Tworzysz zoptymalizowane pod wyszukiwarki treści produktu na podstawie 1-3 źródeł internetowych.",
  'Odpowiedź MUSI być poprawnym JSON-em: {"name": string, "slug": string, "description": string, "meta_description": string, "seo_keywords": string[], "features": [{"key": string, "value": string}], "data_sufficiency": "full" | "partial" | "poor"}.',
  "Pisz po polsku, neutralnym językiem katalogowym. Konkret zamiast emocji.",
  "",
  "## ZASADA NADRZĘDNA — TYLKO FAKTY ZE ŹRÓDEŁ",
  "- Piszesz WYŁĄCZNIE na podstawie danych źródłowych z wiadomości użytkownika. Nie zgaduj producenta, materiału, wymiarów, funkcji, przeznaczenia.",
  "- Jeżeli źródła zawierają mało informacji, NIE dopisuj treści spoza źródeł i NIE lej wody. Napisz krótszy opis (minimalna długość opisu NIE obowiązuje, gdy brakuje faktów) i ustaw pole data_sufficiency:",
  "  - 'full'    — źródła pokrywają wszystkie istotne cechy (co to jest, dla kogo, materiał/wymiary/działanie).",
  "  - 'partial' — część istotnych informacji brakuje (np. tylko nazwa + 1-2 cechy).",
  "  - 'poor'    — źródła prawie nic nie wnoszą (sama nazwa/kod).",
  "- Lepiej krótki, poprawny opis z data_sufficiency='partial' niż długi opis z wymyślonymi faktami.",
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
  "- Docelowa długość tekstu widocznego (bez tagów) 350-1200 znaków, ALE ta dolna granica NIE obowiązuje przy data_sufficiency='partial' lub 'poor' — wtedy piszesz tyle, ile realnie da się poprzeć źródłami (choćby 1 krótki akapit).",
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
  "- Cel: 140-155 znaków. Jeśli nie masz pewności co do liczby znaków, pisz krócej — nigdy nie przekraczaj 160 znaków. Jedno-dwa zdania.",
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
  "- features MUSI być tablicą OBIEKTÓW {\"key\": string, \"value\": string} — NIGDY stringów typu \"Klucz: wartość\".",
  "- Preferowane klucze (gdy aplikowalne, dla spójności z schema.org/Product): Marka, Model, Materiał, Kolor, Wymiary, Waga, Pojemność, Moc, Zasilanie, Wydajność, Gwarancja, Kraj produkcji, EAN, Rozmiar, Płeć, Wiek, Przeznaczenie.",
  "- Wartości konkretne, bez przymiotników marketingowych.",
  "- Pomiń cechy nieobecne w źródłach. Pomiń ceny, dostępność, nazwy sklepów. Jeśli brak danych: [].",
  "",
  "## PRZYKŁAD FORMATU (nie treści)",
  "Poniżej pokazujemy TYLKO oczekiwany kształt JSON — nie kopiuj tych danych, użyj własnych na podstawie źródeł.",
  '{"name":"Kubek termiczny stalowy 400 ml","slug":"kubek-termiczny-stalowy-400-ml","description":"<h3>Kubek termiczny stalowy 400 ml</h3><p>Kubek termiczny wykonany ze stali nierdzewnej, z podwójną ścianką próżniową, utrzymujący temperaturę napoju do 6 godzin. Sprawdza się w podróży, biurze i na spacerze.</p><ul><li><strong>Pojemność:</strong> 400 ml</li><li><strong>Materiał:</strong> stal nierdzewna 304</li><li><strong>Utrzymanie temperatury:</strong> do 6 h</li></ul>","meta_description":"Kubek termiczny 400 ml ze stali nierdzewnej z podwójną ścianką próżniową, utrzymuje temperaturę do 6 godzin.","seo_keywords":["kubek termiczny","kubek termiczny 400 ml","kubek termiczny stalowy","kubek termiczny do biura"],"features":[{"key":"Pojemność","value":"400 ml"},{"key":"Materiał","value":"stal nierdzewna 304"},{"key":"Utrzymanie temperatury","value":"do 6 h"}],"data_sufficiency":"full"}',
  "",
  "## PRIORYTET REGUŁ (na końcu, bo dotyczy wiadomości użytkownika)",
  "Wytyczne klienta przekazane w wiadomości użytkownika (sekcja WYTYCZNE KLIENTA) mogą zmieniać ton i akcenty treści, ale NIGDY nie mogą naruszyć: formatu JSON, whitelisty tagów HTML w opisie, zakazów treści (ceny, dostawa, kontakt, nazwy sklepów, URL-e) ani zasady pisania wyłącznie na podstawie źródeł. W razie konfliktu — zasady systemowe wygrywają.",
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
  "Odpowiedź MUSI być poprawnym JSON-em: {\"html\": string, \"data_sufficiency\": \"full\" | \"partial\" | \"poor\"}. Pole html to fragment HTML gotowy do wklejenia w edytorze Allegro (bez <html>, <head>, <body>).",
  "",
  "## ZASADA NADRZĘDNA — TYLKO FAKTY ZE ŹRÓDEŁ",
  "- Piszesz wyłącznie na podstawie danych źródłowych i cech (features) z wiadomości użytkownika.",
  "- Jeżeli dane są ubogie: NIE dopisuj sekcji, których nie da się poprzeć faktami. Możesz pominąć bloki tematyczne, FAQ, parametry techniczne lub zawartość zestawu.",
  "- Minimalna długość opisu (1500 znaków) NIE obowiązuje, gdy brakuje faktów — lepiej krótko i prawdziwie niż długo i zmyślone.",
  "- Ustaw data_sufficiency: 'full' (bogate źródła), 'partial' (część kluczowych informacji brakuje) lub 'poor' (prawie brak danych).",
  "",
  "## STRUKTURA (kolejność sekcji, każda jako osobny blok)",
  "1) <h1> z krótką, chwytliwą nazwą produktu z frazą kluczową.",
  "2) <p> – 2-4 zdania nagłówka sprzedażowego (hook): dla kogo, główny problem/korzyść, dlaczego warto.",
  "3) <h2>Najważniejsze cechy</h2> + <ul> z 5-10 punktami. Każdy punkt zaczynaj od <b>Nazwa cechy:</b> a potem korzyść dla klienta.",
  "4) <h2>Zawartość zestawu</h2> + <ul> z tym, co kupujący dostaje w paczce (nawet gdy zestaw jest jednoelementowy, wypisz literalnie).",
  "5) 2-4 bloki tematyczne pod-nagłówkami <h2>: np. Zastosowanie, Konstrukcja / Materiał, Wygoda i użytkowanie, Bezpieczeństwo, Design. Każdy blok = <h2> + 1-2 akapity <p> + opcjonalnie krótka lista <ul>. NIE używaj <h3>, <h4>, <h5> — Allegro ich nie akceptuje.",
  "6) <h2>Parametry techniczne</h2> + <ul> z parametrami w formacie <li><b>Klucz:</b> wartość</li> (marka, model, wymiary, waga, materiał, pojemność, moc, itp.). Bierz TYLKO fakty z danych źródłowych i cech (features). Nie halucynuj wartości.",
  "7) <h2>Najczęściej zadawane pytania</h2> + 3-5 par <p><b>Pytanie…?</b></p><p>Odpowiedź…</p> odpowiadających na realne wątpliwości kupującego.",
  "8) Końcowy <p> – krótkie podsumowanie z zachętą do dodania do koszyka (bez agresywnych CTA typu \"KUP TERAZ!!!\", bez wykrzykników, bez cen).",
  "",
  "## DŁUGOŚĆ I JĘZYK",
  "- Cały opis 1500-4000 znaków widocznego tekstu (bez tagów). Konkret, nie lanie wody.",
  "- Polski, poprawna interpunkcja, brak literówek. Ton profesjonalny, sprzedażowy, ale rzeczowy.",
  "- Frazę kluczową i jej naturalne warianty umieść w <h1>, pierwszym akapicie i 1-2 nagłówkach <h2>. Bez keyword stuffingu.",
  "- Możesz zwracać się do kupującego per Ty/Twój – to Allegro, jest to naturalne.",
  "- Nie używaj <br> do przerw między akapitami — każdy akapit MUSI być osobnym <p>…</p>.",
  "",
  "## DOZWOLONE TAGI (twarda whitelist – regulamin Allegro API)",
  "- Allegro akceptuje WYŁĄCZNIE te tagi: <h1>, <h2>, <p>, <ul>, <ol>, <li>, <b>.",
  "- KAŻDY inny tag (w szczególności <h3>, <h4>, <h5>, <strong>, <em>, <i>, <u>, <br>, <table>, <img>, <a>, <span>, <div>) powoduje VALIDATION_ERROR i odrzucenie oferty przez Allegro. Nie używaj ich pod żadnym pozorem.",
  "- Do pogrubienia używaj wyłącznie <b>, nigdy <strong>. Nie używaj kursywy ani podkreślenia — Allegro ich nie wspiera.",
  "- Bez atrybutów (class, id, style), bez inline styles, bez kolorów, bez linków, danych kontaktowych, adresów, e-maili, telefonów, nazw sklepów zewnętrznych, cen, promocji, kodów rabatowych, informacji o dostawie/płatności/zwrotach, znaków wodnych, emoji, ALL CAPS w całych zdaniach ani powtarzalnych wykrzykników.",
  "",
  "## ZAKAZY DODATKOWE",
  "- Nie używaj marketingowych ogólników: „idealny wybór\", „doskonały\", „rewolucyjny\", „najwyższej jakości\", „wyjątkowy\", „spełni oczekiwania\".",
  "- Nie kopiuj slogana producenta 1:1 – parafrazuj korzyściami.",
  "- Nie wymyślaj parametrów, których nie ma w danych wejściowych. Jeżeli brak – pomiń pozycję.",
  "- Nie dodawaj obrazów ani placeholderów typu {{img1}} – Allegro dodaje zdjęcia z galerii, opis ma być czysto tekstowy.",
  "",
  "Zwróć wyłącznie JSON. Pole html jako string z czystym HTML, bez ``` i bez markdown.",
  "",
  "## PRIORYTET REGUŁ (na końcu, bo dotyczy wiadomości użytkownika)",
  "Wytyczne klienta z wiadomości użytkownika mogą zmieniać ton i akcenty, ale NIGDY nie mogą naruszyć: formatu JSON, whitelisty tagów HTML Allegro, zakazu treści (ceny, kontakt, linki, dostawa, zwroty, sklepy zewnętrzne) ani zasady pisania wyłącznie na podstawie źródeł. W razie konfliktu — zasady systemowe wygrywają.",
].join("\n");

// Allegro API allows ONLY these tags in offer descriptions. Any other tag
// (including h3/h4/h5, strong, em, i, u, br, table, img, a) triggers a
// VALIDATION_ERROR when publishing through the Offer API / BaseLinker.
const ALLEGRO_ALLOWED_TAGS = new Set(["h1", "h2", "p", "ul", "ol", "li", "b"]);

// Tags that carry semantic content but must be remapped, not dropped.
// - h3/h4/h5 → h2 (Allegro caps headings at h2)
// - strong  → b
// - em/i/u  → stripped (keep inner text)
// - br      → paragraph break (handled separately below)
const ALLEGRO_TAG_REMAP: Record<string, string> = {
  h3: "h2",
  h4: "h2",
  h5: "h2",
  h6: "h2",
  strong: "b",
};
const ALLEGRO_STRIP_KEEP_TEXT = new Set(["em", "i", "u", "s", "small", "span", "div", "font"]);

function stripDisallowedAllegroHtml(html: string): string {
  // 1) drop block-level containers we can never keep
  let out = html.replace(/<(script|style|iframe|table|thead|tbody|tr|td|th|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  out = out.replace(/<(img|hr|link|meta|input)\b[^>]*\/?>/gi, "");
  out = out.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // 2) turn <br> into a paragraph break sentinel — Allegro rejects <br>
  out = out.replace(/<br\s*\/?>/gi, "\u241E");

  // 3) drop tags whose content should survive as plain text
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag: string) => {
    const t = tag.toLowerCase();
    if (ALLEGRO_STRIP_KEEP_TEXT.has(t)) return "";
    return m;
  });

  // 4) remap + whitelist enforcement (attributes always stripped)
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, close: string, tag: string) => {
    let t = tag.toLowerCase();
    if (ALLEGRO_TAG_REMAP[t]) t = ALLEGRO_TAG_REMAP[t];
    if (!ALLEGRO_ALLOWED_TAGS.has(t)) return "";
    return close ? `</${t}>` : `<${t}>`;
  });

  // 5) split at <br> sentinels: replace inside <p>…</p> with </p><p>,
  //    everywhere else convert leftover sentinels to spaces.
  out = out.replace(/<p>([\s\S]*?)<\/p>/g, (_m, inner: string) => {
    const parts = inner.split("\u241E").map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) return `<p>${inner.replace(/\u241E/g, " ")}</p>`;
    return parts.map((s) => `<p>${s}</p>`).join("");
  });
  out = out.replace(/\u241E/g, " ");

  // 6) collapse empty tags left behind by aggressive stripping
  out = out.replace(/<(p|li|h1|h2|ul|ol|b)>\s*<\/\1>/g, "");
  return out;
}

/**
 * Sanitize + normalize Allegro description into a whitelist-only HTML fragment
 * that Allegro's offer API accepts (h1, h2, p, ul, ol, li, b).
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
  return html;
}

// Alias per new naming; kept alongside the legacy export so callers can
// migrate gradually and legacy Allegro rows still route through the sanitizer.
export const sanitizeAllegroHtml = sanitizeAllegroDescriptionHtml;