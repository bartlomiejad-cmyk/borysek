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
];

const DESC_CUT_HEADINGS: RegExp[] = [
  /^#{1,6}?\s*(polecane|polecamy|zobacz te[zż]|klienci kupili|klienci polecaj[aą]|powi[aą]zane|opinie|recenzje|komentarze|stopka|dane kontaktowe|kontakt|regulamin|newsletter|p[łl]atno[śs]ci|dostawa|zwroty|address|adres|contact|sklep stacjonarny|stationary store)\b/i,
];

const PHONE_RE = /\+?\d{2,3}[ \-.]?\d{3}[ \-.]?\d{3}[ \-.]?\d{3}/g;
const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;

export function sanitizeProductDescription(input: string | null | undefined): string {
  if (!input) return "";
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (DESC_CUT_HEADINGS.some((re) => re.test(line.trim()))) break;
    const imgMatch = /^\s*!\[[^\]]*\]\((https?:[^)\s]+)\)\s*$/i.exec(line);
    if (imgMatch && isJunkImageUrl(imgMatch[1])) continue;
    if (DESC_BLOCK_PHRASES.some((re) => re.test(line))) continue;
    // Linia adresowa: [KOD-POCZTOWY MIASTO ...] (https://...)
    if (/^\s*\[\d{2}[-\s]?\d{3}[^\]]*\]\s*\(https?:[^)]+\)\s*$/i.test(line)) continue;
    // Standalone link markdown do Google Maps
    if (/^\s*\[[^\]]*\]\(https?:[^)]*google\.com\/maps[^)]*\)\s*$/i.test(line)) continue;
    const trimmed = line.trim();
    PHONE_RE.lastIndex = 0;
    if (trimmed && PHONE_RE.test(trimmed) && trimmed.replace(PHONE_RE, "").trim().length < 8) continue;
    PHONE_RE.lastIndex = 0;
    EMAIL_RE.lastIndex = 0;
    if (trimmed && EMAIL_RE.test(trimmed) && trimmed.replace(EMAIL_RE, "").trim().length < 8) continue;
    EMAIL_RE.lastIndex = 0;
    kept.push(line);
  }
  let out = kept.join("\n");
  out = out.replace(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g, (m, url: string) => (isJunkImageUrl(url) ? "" : m));
  // Inline linki Google Maps wewnątrz akapitów.
  out = out.replace(/\[[^\]]*\]\(https?:[^)]*google\.com\/maps[^)]*\)/gi, "");
  out = out.replace(PHONE_RE, "");
  out = out.replace(EMAIL_RE, "");
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (out.length > 3000) out = `${out.slice(0, 3000).trimEnd()}…`;
  return out;
}