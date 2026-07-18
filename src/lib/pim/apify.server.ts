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
  /**
   * Coarse-grained outcome for the caller:
   *   - "ok"               : run succeeded with >=1 organic result
   *   - "empty"            : run succeeded, zero organic results
   *   - "error"            : actor / HTTP error, retriable or otherwise
   *   - "quota_exhausted"  : provider signalled quota / rate-limit
   */
  status?: "ok" | "empty" | "error" | "quota_exhausted";
  /**
   * Diagnostic capture for bare-numeric (EAN-like) queries that returned
   * zero organic results. Populated at most once per `runSerpSearch` call
   * (first empty numeric variant). Used to investigate whether the actor
   * is returning a non-organic payload (captcha, related searches, US
   * proxy fallback, etc.) despite the same query having Polish results.
   */
  apify_raw_sample?: string;
  apify_input_sample?: Record<string, unknown>;
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
  limit?: number;     // 10-100, default 10
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
      (err as Error & { httpStatus?: number }).httpStatus = res.status;
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

function classifyErrorStatus(err: unknown): "quota_exhausted" | "error" {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { httpStatus?: number } | null)?.httpStatus;
  if (status === 402 || status === 429) return "quota_exhausted";
  if (/quota|rate.?limit|too many|payment required|insufficient/i.test(msg)) return "quota_exhausted";
  return "error";
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
  const limit = Math.max(10, Math.min(100, opts.limit ?? 10));
  const timeoutMs = opts.timeoutMs ?? 60_000;

  // Numeric-sample capture is per-call; guard against parallel writes.
  let numericSampleCaptured = false;
  const buildInput = (keyword: string): Record<string, unknown> => {
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
    return input;
  };

  const runOneVariant = async (keyword: string): Promise<SerpBucket> => {
    const input = buildInput(keyword);
    const meta: SerpMeta = {
      provider: "apify",
      input: { keyword, gl, hl, limit },
      results_count: 0,
      status: "empty",
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
      meta.status = results.length > 0 ? "ok" : "empty";
      // Diagnostics: bare-numeric queries (EAN-like) sometimes come back
      // empty even though the same search in Polish Google UI has hits.
      // Snapshot the raw dataset so we can see what the actor returned
      // (related searches, captcha, non-organic blocks, empty array, etc.).
      if (!numericSampleCaptured && results.length === 0 && /^\d+$/.test(keyword)) {
        try {
          const raw = JSON.stringify(items).slice(0, 4096);
          meta.apify_raw_sample = raw;
          meta.apify_input_sample = { ...input };
          numericSampleCaptured = true;
        } catch {
          // ignore serialization errors — diagnostics only
        }
      }
      return { query: keyword, results, meta };
    } catch (e) {
      meta.error = e instanceof Error ? e.message : String(e);
      meta.status = classifyErrorStatus(e);
      return { query: keyword, results: [], meta };
    }
  };

  // Parallel per-variant execution. Account limit is 5 concurrent runs and
  // discovery keeps variants per product ≤ 4, so this is safe as long as
  // callers do not overlap product-level invocations.
  const settled = await Promise.allSettled(clean.map((q) => runOneVariant(q)));
  const buckets: SerpBucket[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      buckets.push(s.value);
    } else {
      const keyword = clean[i];
      const err = s.reason;
      buckets.push({
        query: keyword,
        results: [],
        meta: {
          provider: "apify",
          input: { keyword, gl, hl, limit },
          results_count: 0,
          status: classifyErrorStatus(err),
          error: err instanceof Error ? err.message : String(err),
        },
      });
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
): Promise<{
  ok: boolean;
  count: number;
  results: SerpResult[];
  gl: string;
  hl: string;
  error?: string;
  keyword: string;
  isNumeric: boolean;
  rawSample?: string;
  inputJson?: string;
}> {
  const gl = (opts.gl ?? "PL").toUpperCase();
  const hl = (opts.hl ?? "pl").toLowerCase();
  try {
    const q = query.trim() || "kawa arabica sklep";
    const isNumeric = /^\d+$/.test(q);
    const [b] = await runSerpSearch([q], { limit: 10, gl, hl, timeoutMs: 45_000 });
    const results = (b?.results ?? []).slice(0, 5);
    return {
      ok: results.length > 0,
      count: b?.results.length ?? 0,
      results,
      gl,
      hl,
      error: b?.meta.error,
      keyword: q,
      isNumeric,
      rawSample: b?.meta.apify_raw_sample,
      inputJson: JSON.stringify(
        b?.meta.apify_input_sample ?? { keyword: q, limit: "10", gl, hl },
      ),
    };
  } catch (e) {
    return {
      ok: false,
      count: 0,
      results: [],
      gl,
      hl,
      error: e instanceof Error ? e.message : String(e),
      keyword: query,
      isNumeric: /^\d+$/.test(query.trim()),
    };
  }
}