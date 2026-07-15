/**
 * Pre-flight availability check for image URLs before they are sent to the
 * AI Gateway. Some scraped image URLs go stale (product taken down, listing
 * expired, CDN reshuffled) — passing them to Gemini Vision fails the whole
 * gateway call with `upstream_error: 404 status code when fetching image`,
 * because the provider fetches every referenced image server-side.
 *
 * This helper runs cheap parallel HEAD probes and returns the subset of URLs
 * that responded 2xx/3xx. Callers can cache the "dead" verdict in
 * `enrichments.image_scores[url].dead = true` so we don't re-probe next run.
 */

export type ProbeResult = {
  alive: string[];
  dead: string[];
};

type ProbeOptions = {
  timeoutMs?: number;
  concurrency?: number;
};

// Browser-like UA so hotlink-protected CDNs behave the same as the client
// will when it renders the <img>. No Referer is set — an image that only
// works when the shop's domain is the referer counts as dead (hotlink).
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function isImageContentType(ct: string | null): boolean {
  if (!ct) return false;
  return ct.trim().toLowerCase().startsWith("image/");
}

async function probeOne(url: string, timeoutMs: number): Promise<boolean> {
  const attempt = async (method: "HEAD" | "GET"): Promise<Response | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { "User-Agent": BROWSER_UA, Accept: "image/*,*/*;q=0.8" };
      if (method === "GET") headers.Range = "bytes=0-1023";
      const res = await fetch(url, { method, redirect: "follow", signal: ctrl.signal, headers });
      return res;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  // Require 2xx (redirects auto-followed). Non-image content-type = dead
  // (hotlink-protected pages usually return HTML with 200).
  const head = await attempt("HEAD");
  if (head && head.status >= 200 && head.status < 300) {
    const ct = head.headers.get("content-type");
    if (isImageContentType(ct)) return true;
    // Some CDNs omit content-type on HEAD — fall through to GET.
    if (ct) return false;
  }
  // 403/405/no-CT on HEAD → GET a byte range and check content-type + magic.
  const get = await attempt("GET");
  if (!get || get.status < 200 || get.status >= 300) return false;
  const ct = get.headers.get("content-type");
  if (isImageContentType(ct)) return true;
  if (ct) return false;
  // No content-type at all: sniff first bytes for known image magic.
  try {
    const buf = new Uint8Array(await get.arrayBuffer());
    if (buf.length < 4) return false;
    // PNG, JPEG, GIF, WebP(RIFF), BMP
    if (buf[0] === 0x89 && buf[1] === 0x50) return true;
    if (buf[0] === 0xff && buf[1] === 0xd8) return true;
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true;
    if (buf[0] === 0x42 && buf[1] === 0x4d) return true;
  } catch { /* ignore */ }
  return false;
}

/**
 * Probe URLs in bounded parallel batches. Preserves input order in `alive`.
 */
export async function probeImageUrls(
  urls: string[],
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const verdicts = new Array<boolean>(urls.length);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= urls.length) break;
      verdicts[idx] = await probeOne(urls[idx], timeoutMs);
    }
  });
  await Promise.all(workers);

  const alive: string[] = [];
  const dead: string[] = [];
  urls.forEach((u, i) => (verdicts[i] ? alive.push(u) : dead.push(u)));
  return { alive, dead };
}
