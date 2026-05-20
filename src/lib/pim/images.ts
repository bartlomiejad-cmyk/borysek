// Pure, client-safe helpers for picking which images to show / export.
// Rules (see .lovable/plan.md):
//   - Hide URLs that the AI flagged (watermark / mismatch) — hard exclude.
//   - Prefer images >= 600x600 (sorted by area desc).
//   - If none qualify, fall back to the single largest available so the
//     product doesn't end up empty.

export type ImageMeta = Record<string, { w: number; h: number } | undefined>;

const MIN_SIDE = 600;

export function pickImages(
  urls: string[],
  meta: ImageMeta,
  hidden: Set<string>,
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

  if (big.length) {
    return big.sort((a, b) => area(meta[b]) - area(meta[a]));
  }

  // Fallback: keep one — the largest known, or the first if all sizes unknown.
  const sorted = [...rest].sort((a, b) => area(meta[b]) - area(meta[a]));
  return sorted.slice(0, 1);
}

function area(m: { w: number; h: number } | undefined): number {
  if (!m) return 0;
  return m.w * m.h;
}
