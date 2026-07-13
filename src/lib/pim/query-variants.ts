/**
 * Buduje warianty zapytań wyszukiwania do Firecrawl Discovery dla
 * pojedynczego produktu. Czysta funkcja bez side-effectów — importowana
 * przez worker `runFirecrawlDiscovery`.
 *
 * Kolejność priorytetów: A (EAN), C (producent + MPN), B (nazwa + producent),
 * D (nazwa bez szumu wariantowego — tylko dla strategii NAZWA i HYBRID).
 * Zwracamy maksymalnie 3 warianty, aby ograniczyć budżet Firecrawl.
 */

export type ProductLike = {
  nazwa: string | null;
  ean: string | null;
  /** Kod producenta / MPN (dla CSV bywa w `source_products.kod`). */
  mpn: string | null;
  producent: string | null;
};

export type QueryStrategy = "EAN" | "NAZWA" | "HYBRID";

export type QueryVariant = {
  /** Krótki identyfikator wariantu: "A" | "B" | "C" | "D". */
  kind: "A" | "B" | "C" | "D";
  query: string;
};

const SIZE_TOKENS = new Set([
  "xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "3xl", "4xl", "5xl",
]);

const COLOR_TOKENS = new Set([
  "czarny", "czarna", "czarne",
  "biały", "biala", "biała", "biale", "białe",
  "czerwony", "czerwona", "czerwone",
  "niebieski", "niebieska", "niebieskie",
  "zielony", "zielona", "zielone",
  "szary", "szara", "szare",
  "różowy", "rozowy", "różowa", "rozowa", "różowe", "rozowe",
  "beżowy", "bezowy", "beżowa", "bezowa", "beżowe", "bezowe",
  "granatowy", "granatowa", "granatowe",
  "brązowy", "brazowy", "brązowa", "brazowa", "brązowe", "brazowe",
  "żółty", "zolty", "żółta", "zolta", "żółte", "zolte",
  "fioletowy", "fioletowa", "fioletowe",
  "pomarańczowy", "pomaranczowy", "pomarańczowa", "pomaranczowa", "pomarańczowe", "pomaranczowe",
]);

/** Rozmiar liczbowy typu 36, 38, 42 lub wymiar/pojemność 250ml, 1l, 30x40. */
const NUMERIC_SIZE_RE = /^\d{2,3}$/;
const CAPACITY_RE = /^\d+(?:[.,]\d+)?(?:ml|l|g|kg|cm|mm|m)$/i;
const DIMENSION_RE = /^\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?(?:x\d+(?:[.,]\d+)?)?$/i;

function isVariantNoise(token: string): boolean {
  const t = token.toLowerCase().replace(/[.,;:]+$/g, "");
  if (!t) return true;
  if (SIZE_TOKENS.has(t)) return true;
  if (COLOR_TOKENS.has(t)) return true;
  if (NUMERIC_SIZE_RE.test(t)) return true;
  if (CAPACITY_RE.test(t)) return true;
  if (DIMENSION_RE.test(t)) return true;
  return false;
}

/** Usuwa ogonowe (trailing) tokeny wariantowe: kolor/rozmiar/pojemność. */
export function stripVariantNoise(name: string): string {
  const tokens = name.trim().split(/\s+/);
  while (tokens.length > 1 && isVariantNoise(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ").trim();
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export function buildQueryVariants(
  product: ProductLike,
  strategy: QueryStrategy,
): QueryVariant[] {
  const nazwa = norm(product.nazwa);
  const ean = norm(product.ean);
  const mpn = norm(product.mpn);
  const producent = norm(product.producent);

  const candidates: QueryVariant[] = [];

  // A: sam EAN.
  if (ean) candidates.push({ kind: "A", query: ean });

  // C: producent + MPN.
  if (mpn && producent) {
    candidates.push({ kind: "C", query: `${producent} ${mpn}` });
  } else if (mpn && !producent) {
    // Bez producenta MPN sam z siebie jest często zbyt ogólny — pomijamy
    // wariant C zgodnie ze specyfikacją (wymaga producenta + MPN).
  }

  // B: nazwa + producent (producent opcjonalny).
  if (nazwa) {
    const q = producent && !nazwa.toLowerCase().includes(producent.toLowerCase())
      ? `${nazwa} ${producent}`
      : nazwa;
    candidates.push({ kind: "B", query: q });
  }

  // D: nazwa bez ogonowego szumu wariantowego — tylko dla NAZWA/HYBRID.
  if ((strategy === "NAZWA" || strategy === "HYBRID") && nazwa) {
    const stripped = stripVariantNoise(nazwa);
    if (stripped && stripped.toLowerCase() !== nazwa.toLowerCase()) {
      candidates.push({ kind: "D", query: stripped });
    }
  }

  // Deduplikacja po znormalizowanym query, cap 3.
  const seen = new Set<string>();
  const out: QueryVariant[] = [];
  for (const c of candidates) {
    const key = c.query.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, query: c.query.replace(/\s+/g, " ").trim() });
    if (out.length >= 3) break;
  }
  return out;
}

/** Normalizuje URL do dedup: lowercase host, bez trailing slash, bez query
 *  poza parametrami wyglądającymi na identyfikator produktu (id, pid, sku,
 *  product_id, itemid). */
export function normalizeUrlForDedup(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const keep = new Set(["id", "pid", "sku", "product_id", "itemid", "productid"]);
    const params: string[] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (keep.has(k.toLowerCase())) params.push(`${k.toLowerCase()}=${v}`);
    }
    params.sort();
    let path = u.pathname.replace(/\/+$/g, "");
    if (!path) path = "/";
    const qs = params.length ? `?${params.join("&")}` : "";
    return `${host}${path}${qs}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/g, "");
  }
}