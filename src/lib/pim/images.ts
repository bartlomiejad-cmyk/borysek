// Pure, client-safe helpers for picking which images to show / export.
// Rules (see .lovable/plan.md):
//   - Hide URLs that the AI flagged (watermark / mismatch) — hard exclude.
//   - Prefer images >= 600x600 (sorted by area desc).
//   - If none qualify, fall back to the single largest available so the
//     product doesn't end up empty.

export type ImageMeta = Record<string, { w: number; h: number } | undefined>;
export type ImageScoreLite = {
  is_central?: number;
  is_clean?: number;
  has_packaging?: number;
  is_banner_or_trash?: boolean;
};
export type ImageScores = Record<string, ImageScoreLite | undefined>;

const MIN_SIDE = 600;

export function pickImages(
  urls: string[],
  meta: ImageMeta,
  hidden: Set<string>,
  scores: ImageScores = {},
): string[] {
  const candidates = urls.filter((u) => !hidden.has(u));
  if (!candidates.length) return [];

  const big: string[] = [];
  const rest: string[] = [];
  for (const u of candidates) {
    const m = meta[u];
    if (m && Math.min(m.w, m.h) >= MIN_SIDE) big.push(u);
    else rest.push(u);
  }

  const cmp = (a: string, b: string) => rankScore(b, meta, scores) - rankScore(a, meta, scores);

  if (big.length) {
    return big.sort(cmp);
  }

  // Fallback: keep one — the largest known, or the first if all sizes unknown.
  const sorted = [...rest].sort(cmp);
  return sorted.slice(0, 1);
}

function area(m: { w: number; h: number } | undefined): number {
  if (!m) return 0;
  return m.w * m.h;
}

function rankScore(url: string, meta: ImageMeta, scores: ImageScores): number {
  const a = area(meta[url]);
  const effectiveArea = a > 0 ? a : 1;
  const s = scores[url];
  if (!s) return a;
  if (s.is_banner_or_trash) return 0;
  const central = s.is_central ?? 0;
  const clean = s.is_clean ?? 0;
  const packaging = s.has_packaging ?? 0;
  return (central + clean + 1.5 * packaging) * effectiveArea;
}
