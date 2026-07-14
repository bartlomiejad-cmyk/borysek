/**
 * Apify SERP client — wraps the
 * `scraperlink/google-search-results-serp-scraper` actor.
 *
 * Actor contract (per actor docs):
 *   Input : { keyword: string (REQUIRED, single query),
 *             limit: 10-100, page?: number,
 *             gl?: ISO country (localizes results),
 *             hl?: Google UI language, lr?: language restriction }
 *     -- NEVER send `country`; that key also forces `proxy_location`, whose
 *        supported list is limited to US/CA and rejects PL.
 *   Output: { query, results: [{ position, title, url, description }],
 *             next_page, next_start }  OR  { error: string }
 *   Rate  : 5 RPS per account. Keywords sequential per run, max 5 concurrent runs.
 *
 * Server-only. Token is read at call time so a missing secret produces a
 * clear runtime error instead of a build-time surprise.
 */

const ACTOR_ID = "scraperlink~google-search-results-serp-scraper";
const ACTOR_RUN_URL = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items`;

export type SerpResult = {
  position: number;
  title: string;
  url: string;
  snippet: string;
  domain: string;
};

export type SerpMeta = {
  provider: "apify";
  input: { keyword: string; gl: string; hl: string; limit: number };
  results_count: number;
  error?: string;
};

export type SerpBucket = {
  query: string;
  results: SerpResult[];
  meta: SerpMeta;
};

export type SerpOpts = {
  gl?: string;        // ISO country for localized results, default "PL"
  hl?: string;        // Google UI language, default "pl"
  lr?: string;        // optional language restriction (e.g. "lang_pl")
  limit?: number;     // 10-100, default 100
  timeoutMs?: number; // default 60_000
};

import { stripTrackingParams } from "./query-variants";

function requireApifyToken(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) {
    throw new Error(
      "Brak APIFY_TOKEN — dodaj sekret w ustawieniach Lovable, aby użyć Google SERP (Apify).",
    );
  }
  return t;
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

type DatasetItem = {
  query?: string;
  results?: Array<{
    position?: number;
    title?: string;
    url?: string;
    description?: string;
  }>;
  next_page?: string | null;
  next_start?: number | null;
  error?: string;
};

function normalizeResults(items: DatasetItem[]): SerpResult[] {
  const out: SerpResult[] = [];
  let i = 0;
  for (const item of items) {
    for (const r of item.results ?? []) {
      const rawUrl = (r?.url ?? "").toString().trim();
      if (!rawUrl) continue;
      const url = stripTrackingParams(rawUrl);
      i++;
      out.push({
        position: Number(r?.position ?? i) || i,
        title: (r?.title ?? "").toString().slice(0, 400),
        url,
        // Actor field is `description` — map it to our `snippet` shape.
        snippet: (r?.description ?? "").toString().slice(0, 600),
        domain: hostOf(url),
      });
    }
  }
  return out;
}

async function runOnce(
  token: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<DatasetItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ACTOR_RUN_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const trimmed = text.slice(0, 300);
      const err = new Error(`Apify actor HTTP ${res.status}${trimmed ? `: ${trimmed}` : ""}`);
      (err as Error & { retriable?: boolean }).retriable = res.status >= 500;
      throw err;
    }
    const j = (await res.json()) as DatasetItem[] | { items?: DatasetItem[] };
    const arr = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items! : [];
    // Actor communicates job-level errors via an { error } dataset item.
    const errItem = arr.find((it) => typeof (it as DatasetItem).error === "string" && (it as DatasetItem).error);
    if (errItem) {
      const e = new Error(`Apify actor: ${(errItem as DatasetItem).error}`);
      (e as Error & { retriable?: boolean }).retriable = false;
      throw e;
    }
    return arr;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one Apify actor invocation per query variant, sequentially (respects
 * the actor's 5 RPS limit trivially). Each variant becomes its own bucket
 * with meta describing the exact input we sent — the caller logs this per
 * product for audit/debug.
 */
export async function runSerpSearch(
  queries: string[],
  opts: SerpOpts = {},
): Promise<SerpBucket[]> {
  const token = requireApifyToken();
  const clean = queries.map((q) => q.trim()).filter(Boolean);
  if (!clean.length) return [];

  const gl = (opts.gl ?? "PL").toUpperCase();
  const hl = (opts.hl ?? "pl").toLowerCase();
  const limit = Math.max(10, Math.min(100, opts.limit ?? 100));
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const buckets: SerpBucket[] = [];
  for (const keyword of clean) {
    // Actor input validation requires numeric-looking fields as strings
    // (docs list defaults like "10"). Sending a JSON number → HTTP 400
    // "Field input.limit must be string".
    const input: Record<string, unknown> = {
      keyword,
      limit: String(limit),
      gl,
      hl,
    };
    if (opts.lr) input.lr = opts.lr;
    const meta: SerpMeta = {
      provider: "apify",
      input: { keyword, gl, hl, limit },
      results_count: 0,
    };
    try {
      let items = await runOnce(token, input, timeoutMs).catch(async (e) => {
        const err = e as Error & { retriable?: boolean };
        if (err.retriable || err.name === "AbortError") {
          return await runOnce(token, input, timeoutMs);
        }
        throw err;
      });
      if (!Array.isArray(items)) items = [];
      const results = normalizeResults(items);
      meta.results_count = results.length;
      buckets.push({ query: keyword, results, meta });
    } catch (e) {
      meta.error = e instanceof Error ? e.message : String(e);
      buckets.push({ query: keyword, results: [], meta });
    }
  }
  return buckets;
}

export async function serpHealthCheck(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const [b] = await runSerpSearch(["test PL support"], { limit: 10, timeoutMs: 45_000 });
    return { ok: (b?.results.length ?? 0) > 0, count: b?.results.length ?? 0, error: b?.meta.error };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Rich connection test used by the settings UI: returns the top-5 results
 * plus the exact gl/hl used so a US-results regression is visible.
 */
export async function serpSampleQuery(
  query: string,
  opts: { gl?: string; hl?: string } = {},
): Promise<{ ok: boolean; count: number; results: SerpResult[]; gl: string; hl: string; error?: string }> {
  const gl = (opts.gl ?? "PL").toUpperCase();
  const hl = (opts.hl ?? "pl").toLowerCase();
  try {
    const q = query.trim() || "kawa arabica sklep";
    const [b] = await runSerpSearch([q], { limit: 10, gl, hl, timeoutMs: 45_000 });
    const results = (b?.results ?? []).slice(0, 5);
    return {
      ok: results.length > 0,
      count: b?.results.length ?? 0,
      results,
      gl,
      hl,
      error: b?.meta.error,
    };
  } catch (e) {
    return { ok: false, count: 0, results: [], gl, hl, error: e instanceof Error ? e.message : String(e) };
  }
}