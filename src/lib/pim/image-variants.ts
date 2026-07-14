/**
 * Client-safe helpers for identifying and normalizing size-variant URLs.
 *
 * `upgradeToLargeImageUrl` mirrors the server-side implementation in
 * `_workers.server.ts` — pure regex work, safe in the browser bundle. Kept in
 * sync manually; server callers may keep their local copy but should defer to
 * this one when the file is imported in shared code.
 *
 * `baseVariantKey` collapses a URL to a canonical form so we can detect that
 * `.../foo-150x150.jpg`, `.../foo-800x600.jpg` and `.../foo.jpg` all refer to
 * the same photo at different sizes. `getVisibleGallery` uses this to keep
 * only the largest variant in the accepted list.
 */

export function upgradeToLargeImageUrl(input: string): string {
  let u = input;
  u = u.replace(/(https?:\/\/static\.speedline\.dk\/ai\/)(?:38|60|70|140|350|400|600|800|1100|1600)(?=\/|%2f)/i, "$12000");
  u = u.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "$1");
  u = u.replace(/-(?:home|cart|small|medium|thickbox|category|product)_default\./i, "-large_default.");
  u = u.replace(/-(?:home|cart|small|medium|thickbox|category)(\.(?:jpe?g|png|webp|avif))/i, "$1");
  u = u.replace(/_(?:pico|icon|thumb|small|compact|medium|large|grande)(\.|@)/i, "_2048x$1");
  u = u.replace(/_\d{1,4}x(?:\d{1,4})?(\.(?:jpe?g|png|webp|avif))/i, "_2048x$1");
  u = u.replace(/[-_](?:thumb(?:nail)?|mini|tiny|xs|xxs|preview|small)(\.(?:jpe?g|png|webp|avif))/i, "$1");
  u = u.replace(/(-\d+)_\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "$1$2");
  u = u.replace(/_\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "$1");
  u = u.replace(/\/cache\/[a-f0-9]+\/(?:small_image|thumbnail|image)\/\d+x\d+\//i, "/");
  u = u.replace(/\/cache\/[a-f0-9]+\//i, "/");
  u = u.replace(/\/(?:small|thumb|thumbs|thumbnails|mini)\//i, "/source/");
  u = u.replace(/\/(s|m)\/(\d)/i, "/source/$2");
  u = u.replace(/\/(?:thumbnail|thumbnails|thumbs|tiny|preview|resized|scaled|xs|xxs|mini|miniatures|miniatury|w\d{2,4}|h\d{2,4})\//gi, "/");
  u = u.replace(/\/upload\/(?:[a-z]_[^/,]+,?)+\//i, "/upload/");
  try {
    const parsed = new URL(u);
    const drop = ["w", "width", "h", "height", "size", "maxw", "maxh", "imwidth", "imheight", "fit", "resize"];
    let mutated = false;
    for (const k of drop) {
      if (parsed.searchParams.has(k)) {
        parsed.searchParams.delete(k);
        mutated = true;
      }
    }
    if (mutated) u = parsed.toString();
  } catch { /* keep u */ }
  u = u.replace(/=(?:s|w|h)\d{1,4}(-(?:w|h|s)\d{1,4})*([?&]|$)/i, "=s2048$2");
  return u;
}

/**
 * Collapse variant-indicating chunks so different-sized copies of the same
 * photo map to the same string. Intentionally aggressive — false positives
 * (two unrelated images sharing a base key) are unlikely because the URL
 * prefix (host + path) stays intact.
 */
export function baseVariantKey(input: string): string {
  let u = input.toLowerCase();
  try {
    const parsed = new URL(u);
    const drop = ["w", "width", "h", "height", "size", "maxw", "maxh", "imwidth", "imheight", "fit", "resize", "v", "ver"];
    for (const k of drop) parsed.searchParams.delete(k);
    u = parsed.toString();
  } catch { /* ignore */ }
  // WxH size suffix before extension: -150x150.jpg / _800x600.webp
  u = u.replace(/[-_]\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp|avif))/gi, "$1");
  // Size-only suffix: _100.jpg / -800.jpg (2-4 digits followed by ext)
 u = u.replace(/[-_]\d{2,4}(\.(?:jpe?g|png|webp|avif))/gi, "$1");
  // Named size tokens: _small / _medium / _grande / _thumb / _large etc.
  u = u.replace(/[-_](?:pico|icon|thumb(?:nail)?|mini|tiny|xs|xxs|preview|small|compact|medium|large|grande|home|cart|thickbox|category|product)(?:_default)?(\.|@|$|[-_])/gi, "$1");
  // Size path segments: /150x150/ or /400/
  u = u.replace(/\/\d{2,4}x\d{2,4}\//gi, "/");
  u = u.replace(/\/(?:small|thumb|thumbs|thumbnails|mini|tiny|preview|resized|scaled|xs|xxs|w\d{2,4}|h\d{2,4})\//gi, "/");
  // Speed-line /ai/<num>/
  u = u.replace(/\/ai\/\d{2,4}(?=\/|%2f)/gi, "/ai/_");
  // Cloudinary transformations
  u = u.replace(/\/upload\/(?:[a-z]_[^/,]+,?)+\//gi, "/upload/");
  // Google-CDN size hints: =s100 / =w200-h200
  u = u.replace(/=(?:s|w|h)\d{1,4}(?:-(?:w|h|s)\d{1,4})*/gi, "");
  return u;
}

export function areaOf(m: { w?: number; h?: number } | null | undefined): number {
  if (!m) return 0;
  const w = m.w ?? 0;
  const h = m.h ?? 0;
  return w * h;
}

export const MIN_MAIN_IMAGE_SIDE = 800;

export function isLowRes(m: { w?: number; h?: number } | null | undefined, min = MIN_MAIN_IMAGE_SIDE): boolean {
  if (!m || !m.w || !m.h) return false;
  return Math.min(m.w, m.h) < min;
}