/**
 * Pattern-based variant detection v2 (pure, unit-testable).
 *
 * Runs when column-based hierarchy detection finds nothing. Groups rows
 * that share a base after stripping variant tokens: trailing size labels
 * ("r. 40", "roz. 42", bare footwear/apparel sizes) and kod suffixes
 * ("_40", "-42", "_40_bez podnoska").
 *
 * Never mutates rows. Callers apply the returned groupings via a
 * dedicated server function, after user confirmation in the preview
 * dialog.
 */

/** Footwear numeric size range (EU). Tunable in one place. */
export const FOOTWEAR_SIZES: string[] = Array.from({ length: 50 - 35 + 1 }, (_, i) =>
  String(35 + i),
);

/** Apparel size tokens (uppercase). */
export const APPAREL_SIZES: string[] = [
  "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "3XL", "4XL", "5XL",
];

/** Regex fragments recognized as variant labels in a product name. */
export const NAME_SIZE_LABEL_PATTERNS: RegExp[] = [
  // "r. 40", "r 40", "r.40/41", "r.40-41", "rozm. XL"
  /\br\.?\s*\d{2}(?:\s*[/\-,]\s*\d{2})*\b/gi,
  /\broz(?:m)?\.?\s*[A-Z0-9]{1,4}(?:\s*[/\-,]\s*[A-Z0-9]{1,4})*\b/gi,
  /\brozmiar\s*[A-Z0-9]{1,4}\b/gi,
];

export type VariantRowInput = {
  id: string;
  nazwa: string | null;
  kod: string | null;
};

export type VariantGroup = {
  baseName: string;
  baseKod: string | null;
  parentIndex: number | null; // index in original input array
  variantIndices: number[]; // indices in original input array
  /** true when no row exists with the bare base (parent needs synthesizing) */
  missingParent: boolean;
};

export type Phase1Result = {
  groups: VariantGroup[];
  ungroupedIndices: number[];
};

const collapseWs = (s: string) => s.replace(/\s+/g, " ").trim();

/** Normalize a product name for grouping (case-insensitive, punctuation-tolerant). */
export const normalizeName = (raw: string | null | undefined): string => {
  if (!raw) return "";
  return collapseWs(String(raw).toLowerCase())
    .replace(/[.,;:!?"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Strip variant tokens from a name. Returns the base name plus the list of
 * removed tokens (for diagnostics).
 */
export const stripNameVariantTokens = (
  raw: string | null | undefined,
): { base: string; tokens: string[] } => {
  if (!raw) return { base: "", tokens: [] };
  let s = String(raw);
  const tokens: string[] = [];
  for (const re of NAME_SIZE_LABEL_PATTERNS) {
    s = s.replace(re, (m) => { tokens.push(m); return " "; });
  }
  // Bare footwear/apparel size tokens at the tail: " 40", " 40/41", " XL".
  const bareSize = new RegExp(
    `\\b(?:${[...FOOTWEAR_SIZES, ...APPAREL_SIZES].join("|")})(?:\\s*[/\\-,]\\s*(?:${[
      ...FOOTWEAR_SIZES,
      ...APPAREL_SIZES,
    ].join("|")}))*\\b\\s*$`,
    "i",
  );
  const m = s.match(bareSize);
  if (m) { tokens.push(m[0]); s = s.slice(0, m.index); }
  return { base: collapseWs(s), tokens };
};

/**
 * Strip variant suffixes from a kod. "117 S3 HRO_40" → "117 S3 HRO".
 * Conservative: only strips a suffix when it starts with _ or -.
 */
export const stripKodVariantSuffix = (
  raw: string | null | undefined,
): { base: string; suffix: string | null } => {
  if (!raw) return { base: "", suffix: null };
  const s = String(raw).trim();
  // Find a size token that follows a _ or - delimiter ANYWHERE in the code,
  // not only at the very end. This catches sizes embedded mid-code with
  // trailing free-text (spaces allowed), e.g. "201 OB_41_bez podnoska" →
  // base "201 OB", suffix "_41_bez podnoska". The previous end-anchored
  // regex missed these because the trailing text contained a space and never
  // reached the "$" anchor. Control case "117 S3 HRO_40" still yields
  // base "117 S3 HRO", suffix "_40".
  const sizeAlt = [...FOOTWEAR_SIZES, ...APPAREL_SIZES].join("|");
  const embedded = new RegExp(`[_\\-](?:${sizeAlt})(?:[_\\-]|$)`, "i");
  const m = s.match(embedded);
  if (!m || m.index === undefined) return { base: s, suffix: null };
  const base = s.slice(0, m.index).trim();
  if (!base) return { base: s, suffix: null };
  return { base, suffix: s.slice(m.index) };
};

/**
 * Group rows by (baseName, baseKod). A group is emitted when >=2 rows
 * share a base AND at least one row was stripped of a variant token
 * (otherwise we'd merge unrelated identical products).
 */
export const detectVariantGroupsPhase1 = (
  rows: VariantRowInput[],
): Phase1Result => {
  type Bucket = {
    baseName: string;
    baseKod: string | null;
    indices: number[];
    stripped: boolean[]; // per index, was a token stripped?
    parentIndex: number | null;
  };
  const buckets = new Map<string, Bucket>();

  rows.forEach((r, i) => {
    const nameNorm = normalizeName(r.nazwa);
    const { base: nameBase, tokens: nameTokens } = stripNameVariantTokens(r.nazwa);
    const nameBaseNorm = normalizeName(nameBase);
    const { base: kodBase, suffix: kodSuffix } = stripKodVariantSuffix(r.kod);
    const stripped = nameTokens.length > 0 || !!kodSuffix;

    // Key on nameBase; fall back to kodBase only when the name has no base.
    const key = nameBaseNorm || kodBase.toLowerCase();
    if (!nameBaseNorm && !kodBase) return; // completely empty row
    let b = buckets.get(key);
    if (!b) {
      b = {
        baseName: nameBase || r.nazwa || "",
        baseKod: kodBase || null,
        indices: [],
        stripped: [],
        parentIndex: null,
      };
      buckets.set(key, b);
    }
    b.indices.push(i);
    b.stripped.push(stripped);
    // A row where no token was stripped AND its name normalizes to the
    // exact base is the parent candidate.
    if (!stripped && nameNorm === nameBaseNorm) {
      if (b.parentIndex === null) b.parentIndex = i;
    }
  });

  const groups: VariantGroup[] = [];
  const grouped = new Set<number>();
  for (const b of buckets.values()) {
    if (b.indices.length < 2) continue;
    // Require at least one member to have had a token stripped, otherwise
    // this is just duplicate rows, not a variant cluster.
    if (!b.stripped.some(Boolean)) continue;
    const variantIndices = b.indices.filter((i) => i !== b.parentIndex);
    if (variantIndices.length < 1) continue;
    groups.push({
      baseName: b.baseName,
      baseKod: b.baseKod,
      parentIndex: b.parentIndex,
      variantIndices,
      missingParent: b.parentIndex === null,
    });
    for (const i of b.indices) grouped.add(i);
  }

  const ungroupedIndices: number[] = [];
  for (let i = 0; i < rows.length; i++) if (!grouped.has(i)) ungroupedIndices.push(i);

  return { groups, ungroupedIndices };
};