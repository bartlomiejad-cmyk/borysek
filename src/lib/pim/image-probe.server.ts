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

async function probeOne(url: string, timeoutMs: number): Promise<boolean> {
  const attempt = async (method: "HEAD" | "GET"): Promise<Response | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: ctrl.signal,
        // Range keeps GET-fallback cheap on CDNs that reject HEAD.
        headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      });
      return res;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const head = await attempt("HEAD");
  if (head && head.status >= 200 && head.status < 400) return true;
  // Some CDNs return 403/405 for HEAD but serve GET fine.
  if (head && (head.status === 403 || head.status === 405)) {
    const get = await attempt("GET");
    if (get && get.status >= 200 && get.status < 400) return true;
  }
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
