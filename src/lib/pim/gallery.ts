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
  /** Probed image dimensions (persisted after size probe). */
  w?: number;
  h?: number;
  /**
   * Best-effort upgraded URL variant (e.g. thumbnail → source-size). Only set
   * when the upgraded URL responded and returned larger dimensions than the
   * original. Callers should use it as the download target for regen / AI.
   */
  large_url?: string;
  /** URL of the largest sibling variant this image was deduped into. */
  dedup_of?: string;
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
  /**
   * URLs that failed the availability probe (404, non-image content-type,
   * hotlink-protected, dimensions unparseable). Excluded from every
   * client-facing surface; surfaced separately in the editor for re-probe.
   * Manually-kept images that turned dead are excluded here too.
   */
  dead: string[];
  /**
   * Compatible-mode only: accepted images that come from equivalent
   * (non-primary) sources. Never auto-selected as main; users can promote
   * individually via manual_keep.
   */
  otherEquivalents: string[];
};

/**
 * Per-source context used to enforce compatible-mode gallery policy:
 * accepted images only come from the single best-ranked source (plus
 * pinned + manual_keep). Everything else moves to `otherEquivalents`.
 */
export type GallerySourceContext = {
  /** Source page URL. */
  url: string;
  /** Match score (from enrichments.score_breakdown[].total). */
  score: number;
  /** Image URLs contributed by this source (main + extra). */
  images: string[];
};

export type GalleryOptions = {
  matchingMode?: "strict" | "compatible";
  sources?: readonly GallerySourceContext[];
};

import { baseVariantKey } from "./image-variants";

export function getVisibleGallery(
  urls: readonly string[],
  enrichment: GalleryEnrichment | null | undefined,
  options?: GalleryOptions,
): VisibleGallery {
  const hidden = new Set((enrichment?.hidden_images ?? []) as string[]);
  const scores = (enrichment?.image_scores ?? {}) as Record<string, GalleryImageScore | undefined>;
  const pinned = (enrichment?.pinned_main_url ?? null) as string | null;

  const accepted: string[] = [];
  const unsure: string[] = [];
  const rejected: string[] = [];
  const dead: string[] = [];
  const seen = new Set<string>();

  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    if (hidden.has(u)) continue;
    const s = scores[u];
    if (s?.manual_keep === true) {
      // Manual keep wins over AI verdicts — but a manually-kept image that
      // turned dead is still hidden from client surfaces (owner gets a
      // warning icon in the editor).
      if (s.dead === true) { dead.push(u); continue; }
      accepted.push(u);
      continue;
    }
    if (s?.is_banner_or_trash === true) continue;
    if (s?.dead === true) { dead.push(u); continue; }
    const identity = s?.identity;
    if (identity === "different") rejected.push(u);
    else if (identity === "unsure") unsure.push(u);
    else accepted.push(u); // "same" or unscored
  }

  // Size-variant deduplication: if two accepted URLs collapse to the same
  // canonical form, keep only the largest by pixel area. Others become
  // hidden duplicates (not surfaced in unsure/rejected). Pinned always
  // survives even if a larger sibling exists — user's explicit choice.
  if (accepted.length > 1) {
    const groups = new Map<string, string[]>();
    for (const u of accepted) {
      const key = baseVariantKey(u);
      const arr = groups.get(key) ?? [];
      arr.push(u);
      groups.set(key, arr);
    }
    const keep = new Set<string>();
    for (const arr of groups.values()) {
      if (arr.length === 1) {
        keep.add(arr[0]);
        continue;
      }
      const withPinned = pinned && arr.includes(pinned) ? pinned : null;
      let bestUrl = withPinned ?? arr[0];
      let bestArea = -1;
      for (const u of arr) {
        const s = scores[u];
        const area = (s?.w ?? 0) * (s?.h ?? 0);
        if (area > bestArea) {
          bestArea = area;
          bestUrl = u;
        }
      }
      // Honour explicit pin
      keep.add(withPinned ?? bestUrl);
    }
    // Preserve original order
    const filtered = accepted.filter((u) => keep.has(u));
    accepted.length = 0;
    accepted.push(...filtered);
  }

  // Pin the main image first when it survived.
  if (pinned && accepted.includes(pinned)) {
    const idx = accepted.indexOf(pinned);
    if (idx > 0) {
      accepted.splice(idx, 1);
      accepted.unshift(pinned);
    }
  }

  // Compatible-mode split: only the single best-ranked source's images
  // (plus pinned + manual_keep) count as accepted. Everything else from
  // equivalent sources moves to `otherEquivalents` — never auto-selected
  // as main, but promotable by the user via manual_keep.
  const otherEquivalents: string[] = [];
  if (options?.matchingMode === "compatible" && options.sources && options.sources.length > 0) {
    const bestSource = [...options.sources].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    const bestImages = new Set(bestSource?.images ?? []);
    const finalAccepted: string[] = [];
    for (const u of accepted) {
      const s = scores[u];
      if (s?.manual_keep === true) { finalAccepted.push(u); continue; }
      if (pinned && u === pinned) { finalAccepted.push(u); continue; }
      if (bestImages.has(u)) { finalAccepted.push(u); continue; }
      otherEquivalents.push(u);
    }
    accepted.length = 0;
    accepted.push(...finalAccepted);
  }

  return { accepted, unsure, rejected, dead, otherEquivalents };
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
