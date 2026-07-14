// Client-safe helper: derives which images belong in the visible product
// gallery vs the "needs review" (unsure) / "rejected (different product)"
// buckets. Single source of truth for the product list, editor, share card
// and export so rejected/unsure verdicts never leak to CSV or clients.
//
// Rule order (per spec):
//   1. `hidden_images` → excluded from every bucket.
//   2. `manual_keep === true` → accepted (overrides AI verdicts).
//   3. `is_banner_or_trash === true` → excluded from every bucket.
//   4. `dead === true` → excluded (unreachable image).
//   5. `identity === 'same'` → accepted.
//      `identity === 'unsure'` → unsure.
//      `identity === 'different'` → rejected.
//      no identity score → accepted (default).
// Tier ordering (input order) is preserved. `pinnedMainUrl` is always the
// first entry in `accepted` if it survives the rules.

export type GalleryImageScore = {
  is_banner_or_trash?: boolean;
  identity?: "same" | "different" | "unsure";
  manual_keep?: boolean;
  dead?: boolean;
  identity_v?: number;
};

export type GalleryEnrichment = {
  hidden_images?: string[] | null;
  image_scores?: Record<string, GalleryImageScore | undefined> | null;
  pinned_main_url?: string | null;
};

export type VisibleGallery = {
  accepted: string[];
  unsure: string[];
  rejected: string[];
};

export function getVisibleGallery(
  urls: readonly string[],
  enrichment: GalleryEnrichment | null | undefined,
): VisibleGallery {
  const hidden = new Set((enrichment?.hidden_images ?? []) as string[]);
  const scores = (enrichment?.image_scores ?? {}) as Record<string, GalleryImageScore | undefined>;
  const pinned = (enrichment?.pinned_main_url ?? null) as string | null;

  const accepted: string[] = [];
  const unsure: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    if (hidden.has(u)) continue;
    const s = scores[u];
    if (s?.manual_keep === true) {
      accepted.push(u);
      continue;
    }
    if (s?.is_banner_or_trash === true) continue;
    if (s?.dead === true) continue;
    const identity = s?.identity;
    if (identity === "different") rejected.push(u);
    else if (identity === "unsure") unsure.push(u);
    else accepted.push(u); // "same" or unscored
  }

  // Pin the main image first when it survived.
  if (pinned && accepted.includes(pinned)) {
    const idx = accepted.indexOf(pinned);
    if (idx > 0) {
      accepted.splice(idx, 1);
      accepted.unshift(pinned);
    }
  }

  return { accepted, unsure, rejected };
}

/**
 * Convenience wrapper — returns just the accepted URLs, applying `pickThumbsForList`-style
 * size preferences via a scorer callback so callers can rank by area or AI composition scores.
 * If no scorer is provided, tier/insertion order is preserved (with pinned first).
 */
export function getAcceptedImages(
  urls: readonly string[],
  enrichment: GalleryEnrichment | null | undefined,
): string[] {
  return getVisibleGallery(urls, enrichment).accepted;
}
