/**
 * Deterministyczne sito danych scrape'owanych z product_sources.
 * Wycina chrome sklepu (logo metod płatności, certyfikaty, ikony kontaktu,
 * banery, stopki) niezależnie od AI. Czysty TS — importowalny po obu stronach.
 */

const JUNK_FILENAME_TOKENS: string[] = [
  "blik", "paypal", "visa", "mastercard", "mc-logo", "maestro",
  "przelewy24", "p24", "payu", "bluemedia", "blue-media", "dotpay",
  "paysafe", "apple-pay", "applepay", "google-pay", "googlepay", "zelewy",
  "gwarancj", "najlepsza-cena", "najlepszacena", "certyfikat",
  "trustmark", "trust-mark", "opineo", "ceneo-badge", "ssl-", "secure-",
  "kontakt", "phone", "tel-", "telefon", "envelope", "mail-icon",
  "facebook", "instagram", "youtube", "tiktok", "whatsapp", "messenger", "twitter",
  "banner", "header", "footer", "icon-", "-icon", "sprite", "placeholder", "loader", "spinner",
  "brand", "producent", "manufacturer", "marka",
];

const JUNK_PATH_TOKENS: string[] = [
  "/icons/", "/icon/", "/logos/", "/logo/", "/banners/", "/banner/",
  "/payment", "/payments", "/cms/", "/storefront/images/", "/static/icons/",
];

const THUMB_HINTS: RegExp[] = [
  /[_-](xs|sm|mini|thumb|thumbnail|small|tiny)(\.|_|-|\b)/i,
  /=s\d{1,3}([?&]|$)/,
  /=w\d{1,3}([?&]|$)/,
  /=h\d{1,3}([?&]|$)/,
];

export function isJunkImageUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return true;
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return true;
  let pathLower = "";
  let fileLower = "";
  try {
    const u = new URL(url);
    pathLower = u.pathname.toLowerCase();
    fileLower = pathLower.split("/").pop() ?? "";
  } catch {
    return true;
  }
  if (/\.svg(\?|$)/i.test(pathLower)) return true;
  if (/\.gif(\?|$)/i.test(pathLower)) return true;
  for (const t of JUNK_PATH_TOKENS) if (pathLower.includes(t)) return true;
  for (const t of JUNK_FILENAME_TOKENS) if (fileLower.includes(t)) return true;
  for (const re of THUMB_HINTS) if (re.test(url)) return true;
  return false;
}

export function filterImageUrls(urls: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u || typeof u !== "string" || seen.has(u)) continue;
    if (isJunkImageUrl(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sekcja "## Description" — jeżeli markdown ma taki nagłówek, wycinamy TYLKO
// jego treść do najbliższego kolejnego nagłówka (dowolny ##/###...). Dzięki temu
// AI-filter nie dostaje na wejściu polityki wysyłki, recenzji, "Related", itp.
// ---------------------------------------------------------------------------

const DESC_HEADING_RE =
  /^\s{0,3}(?:#{1,6}\s+|\*\*\s*)?(?:product\s+)?(description|opis|product\s+details|details|specification|specyfikacja)\s*[:\s*]{0,4}\**\s*$/im;

const NEXT_HEADING_RE = /^\s{0,3}(?:#{1,6}\s+\S|\*\*[^\n]+\*\*\s*$)/m;

const SKIP_SECTION_HEADINGS =
  /^\s{0,3}#{1,6}\s+(reviews?|shipping|delivery|returns?|payments?|warranty|about\s+us|contact|faq|related|you\s+may\s+also\s+like|recenzje|opinie|dostawa|zwroty|p[łl]atno[śs]ci|kontakt|polecane)\b/i;

export function extractDescriptionSection(md: string | null | undefined): string | null {
  if (!md) return null;
  const text = md.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DESC_HEADING_RE.test(line) && !SKIP_SECTION_HEADINGS.test(line)) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (NEXT_HEADING_RE.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  const body = lines.slice(startIdx, endIdx).join("\n").trim();
  return body.length ? body : null;
}

const DESC_BLOCK_PHRASES: RegExp[] = [
  /zapytaj o produkt/i,
  /udost[ęe]pnij/i,
  /dodaj do schowka/i,
  /wystaw opini/i,
  /napisz opini/i,
  /newsletter/i,
  /gwarancja bezpiecznego zakupu/i,
  /bezpieczne zakupy/i,
  /najlepsza cena/i,
  /sposob[yó]? p[łl]atno[śs]ci/i,
  /sposob[yó]? dostaw/i,
  /koszty dostawy/i,
  /czas dostawy/i,
  /zwroty/i,
  /reklamacj/i,
  /zadzwo[nń] i zam[oó]w/i,
  /\[kontakt\]/i,
  /tel:\s*[+\d]/i,
  /mailto:/i,
  // angielskie chrome sklepu
  /only available in our stationary store/i,
  /stationary store/i,
  /installments? (for|are) /i,
  /working hours?/i,
  /opening hours?/i,
  /mon\.?\s*[-–—]\s*fri\.?/i,
  /pon\.?\s*[-–—]\s*pt\.?/i,
  /google\.com\/maps/i,
  // recenzje/akcje sklepowe (PL/EN)
  /\(?\s*write a review\s*\)?/i,
  /^follow\s*compare\s*$/i,
  /^follow$/i,
  /^compare$/i,
  /^obserwuj$/i,
  /^por[óo]wnaj$/i,
  /\bsaturday\b/i,
  /\bsunday\b/i,
  /\bmonday\b/i,
  /\btuesday\b/i,
  /\bwednesday\b/i,
  /\bthursday\b/i,
  /\bfriday\b/i,
  /\bniedziela\b/i,
  /\bsobota\b/i,
  // godziny w formacie "10:00 am - 6:00 pm" lub "10:00 - 18:00"
  /\d{1,2}:\d{2}\s*(am|pm)?\s*[-–—]\s*\d{1,2}:\d{2}\s*(am|pm)?/i,
  // === Angielskie chrome sklepu / e‑commerce ===
  /^\s*was\s*:?\s*$/i,
  /^\s*now\s*:?\s*$/i,
  /you save/i,
  /nan% on this product/i,
  /^\s*sku\s*:/i,
  /^\s*upc\s*:/i,
  /^\s*current stock\s*:/i,
  /decrease quantity/i,
  /increase quantity/i,
  /adding to cart/i,
  /the item has been added/i,
  /stock coming soon/i,
  /^\s*out of stock\s*$/i,
  /email\s+when\s+available/i,
  /uk shipping/i,
  /standard delivery/i,
  /click\s*&\s*collect/i,
  /photo id/i,
  /restricted products?/i,
  /ship to local rfd/i,
  /local rfd/i,
  /international shipping/i,
  /import duties?/i,
  /customs (policies|clearance|authorities|office)/i,
  /shipping quote/i,
  /bank holidays?/i,
  /postal strikes?/i,
  /remote postcodes?/i,
  /exchanges? & refunds?/i,
  /refund policy/i,
  /return form/i,
  /original (product )?packaging/i,
  /product labels attached/i,
  /28 days of purchase/i,
  /package up the items/i,
  // Ceny walutowe stojące same w linii
  /^\s*[£€$]\s*\d/,
  /^\s*\d+([.,]\d+)?\s*(gbp|eur|usd|pln|z[łl])\s*$/i,
  // Separatory
  /^\s*(\*\s*){3,}\s*$/,
  /^\s*(-\s*){3,}\s*$/,
  /^\s*_{3,}\s*$/,
];

const DESC_CUT_HEADINGS: RegExp[] = [
  /^#{1,6}?\s*(polecane|polecamy|zobacz te[zż]|klienci kupili|klienci polecaj[aą]|powi[aą]zane|opinie|recenzje|komentarze|stopka|dane kontaktowe|kontakt|regulamin|newsletter|p[łl]atno[śs]ci|dostawa|zwroty|address|adres|contact|sklep stacjonarny|stationary store)\b/i,
];

const PHONE_RE = /\+?\d{2,3}[ \-.]?\d{3}[ \-.]?\d{3}[ \-.]?\d{3}/g;
const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;

const PRICE_RE = /^\s*\d{1,4}([.,]\d{1,2})?\s*(z[łl]|pln|eur|usd|€|\$)\s*$/i;
const SKU_LINE_RE = /^\s*\d{2,4}[-\s]\d{2,4}\s*$/;

export function sanitizeProductDescription(input: string | null | undefined): string {
  if (!input) return "";
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (DESC_CUT_HEADINGS.some((re) => re.test(line.trim()))) break;
    const trimmedRaw = line.trim();
    // Każdy markdown-image w osobnej linii usuwamy — w opisie nie chcemy
    // galerii produktu (zdjęcia obsługujemy oddzielnie przez images/extra_images).
    if (/^\s*!\[[^\]]*\]\((https?:[^)\s]+)\)\s*$/i.test(line)) continue;
    // Linkowane logo / nagłówek brandu typu: [![Logo ...](img)](url)
    if (/^\s*\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)\s*$/i.test(line)) continue;
    // Cena samodzielna w linii.
    if (PRICE_RE.test(line)) continue;
    // Numer SKU "242-066" sam w linii.
    if (SKU_LINE_RE.test(line)) continue;
    if (DESC_BLOCK_PHRASES.some((re) => re.test(line))) continue;
    // Linia adresowa: [KOD-POCZTOWY MIASTO ...] (https://...)
    if (/^\s*\[\d{2}[-\s]?\d{3}[^\]]*\]\s*\(https?:[^)]+\)\s*$/i.test(line)) continue;
    // Linia zaczynająca się od kodu pocztowego (PL): "41-253 Czeladź..."
    if (/^\s*\d{2}-\d{3}\s+\S/.test(trimmedRaw)) continue;
    // Standalone link markdown do Google Maps
    if (/^\s*\[[^\]]*\]\(https?:[^)]*google\.com\/maps[^)]*\)\s*$/i.test(line)) continue;
    const trimmed = trimmedRaw;
    PHONE_RE.lastIndex = 0;
    if (trimmed && PHONE_RE.test(trimmed) && trimmed.replace(PHONE_RE, "").trim().length < 8) continue;
    PHONE_RE.lastIndex = 0;
    EMAIL_RE.lastIndex = 0;
    if (trimmed && EMAIL_RE.test(trimmed) && trimmed.replace(EMAIL_RE, "").trim().length < 8) continue;
    EMAIL_RE.lastIndex = 0;
    kept.push(line);
  }
  let out = kept.join("\n");
  // Wytnij WSZYSTKIE markdown-images z opisu (galerie produktu obsługujemy osobno).
  out = out.replace(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g, "");
  // Linkowane obrazki [![alt](img)](url) — też brand-logo i miniatury.
  out = out.replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, "");
  // Inline linki Google Maps wewnątrz akapitów.
  out = out.replace(/\[[^\]]*\]\(https?:[^)]*google\.com\/maps[^)]*\)/gi, "");
  out = out.replace(PHONE_RE, "");
  out = out.replace(EMAIL_RE, "");
  // Osierocone fragmenty markdown po wycięciu obrazków: "[", "](url)", puste linki.
  out = out.replace(/\[\]\([^)]*\)/g, "");
  out = out.replace(/^\s*[\[\]()]+\s*$/gm, "");
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (out.length > 3000) out = `${out.slice(0, 3000).trimEnd()}…`;
  return out;
}