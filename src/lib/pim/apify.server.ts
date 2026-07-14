/**
 * Apify SERP client — thin wrapper around the
 * `scraperlink/google-search-results-serp-scraper` actor used as an
 * alternative to Firecrawl search in discovery.
 *
 * Server-only. Token is read at call time so a missing secret produces a
 * clear runtime error instead of a build-time surprise.
 */

const ACTOR_ID = "scraperlink~google-search-results-serp-scraper";
const ACTOR_INFO_URL = `https://api.apify.com/v2/acts/${ACTOR_ID}`;
const ACTOR_RUN_URL = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items`;

export type SerpResult = {
  position: number;
  title: string;
  url: string;
  snippet: string;
  domain: string;
};

export type SerpBucket = {
  query: string;
  results: SerpResult[];
};

export type SerpOpts = {
  country?: string;   // ISO code, default "PL"
  language?: string;  // 2-letter, default "pl"
  resultsPerQuery?: number; // default 100
  timeoutMs?: number; // default 60_000
};

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

/**
 * Cache actor input field-name hints for the lifetime of the Worker
 * instance. We only need this once per process — actor input schemas
 * evolve rarely and any change is caught by the settings validation.
 */
let cachedFieldHints: { multi: string | null; single: string | null } | null = null;

async function detectFieldNames(token: string): Promise<{ multi: string | null; single: string | null }> {
  if (cachedFieldHints) return cachedFieldHints;
  try {
    const res = await fetch(`${ACTOR_INFO_URL}?token=${encodeURIComponent(token)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const j = (await res.json()) as { data?: { defaultRunOptions?: unknown; exampleRunInput?: { body?: string } } };
      const example = j?.data?.exampleRunInput?.body;
      if (typeof example === "string") {
        try {
          const parsed = JSON.parse(example) as Record<string, unknown>;
          const multi = ["queries", "searchTerms", "searchQueries", "keywords"].find((k) =>
            Array.isArray(parsed[k]) || typeof parsed[k] === "string",
          ) ?? null;
          const single = ["query", "searchTerm", "keyword"].find((k) => typeof parsed[k] === "string") ?? null;
          cachedFieldHints = { multi, single };
          return cachedFieldHints;
        } catch {
          // ignore parse errors — fall through to defaults
        }
      }
    }
  } catch {
    // ignore — we fall back to defaults
  }
  // Sensible defaults for scraperlink actor / most Google SERP actors.
  cachedFieldHints = { multi: "queries", single: "query" };
  return cachedFieldHints;
}

type DatasetItem = {
  searchQuery?: { term?: string; query?: string } | string;
  query?: string;
  keyword?: string;
  organicResults?: Array<{
    position?: number;
    rank?: number;
    title?: string;
    url?: string;
    link?: string;
    description?: string;
    snippet?: string;
    displayedUrl?: string;
  }>;
  results?: Array<Record<string, unknown>>;
};

function normalizeItem(item: DatasetItem, fallbackQuery: string): SerpBucket {
  let q = fallbackQuery;
  const sq = item.searchQuery;
  if (typeof sq === "string" && sq.trim()) q = sq.trim();
  else if (sq && typeof sq === "object") q = (sq.term || sq.query || fallbackQuery).toString();
  else if (typeof item.query === "string" && item.query.trim()) q = item.query.trim();
  else if (typeof item.keyword === "string" && item.keyword.trim()) q = item.keyword.trim();

  const raw = item.organicResults ?? (item.results as DatasetItem["organicResults"] | undefined) ?? [];
  const results: SerpResult[] = [];
  let i = 0;
  for (const r of raw) {
    const url = (r?.url || r?.link || "").toString().trim();
    if (!url) continue;
    i++;
    results.push({
      position: Number(r?.position ?? r?.rank ?? i) || i,
      title: (r?.title ?? "").toString().slice(0, 400),
      url,
      snippet: (r?.description ?? r?.snippet ?? "").toString().slice(0, 600),
      domain: hostOf(url),
    });
  }
  return { query: q, results };
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
      // Mark 5xx as retriable via a flag on the Error object.
      (err as Error & { retriable?: boolean }).retriable = res.status >= 500;
      throw err;
    }
    const j = (await res.json()) as DatasetItem[] | { items?: DatasetItem[] };
    if (Array.isArray(j)) return j;
    return Array.isArray(j?.items) ? j.items : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one Apify SERP job for a batch of queries (typically the query
 * variants of a single product). Returns one bucket per query, in the
 * order they were requested. Silently drops queries the actor did not
 * return.
 */
export async function runSerpSearch(
  queries: string[],
  opts: SerpOpts = {},
): Promise<SerpBucket[]> {
  const token = requireApifyToken();
  const clean = queries.map((q) => q.trim()).filter(Boolean);
  if (!clean.length) return [];

  const country = (opts.country ?? "PL").toUpperCase();
  const language = (opts.language ?? "pl").toLowerCase();
  const resultsPerQuery = Math.max(10, Math.min(100, opts.resultsPerQuery ?? 100));
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const { multi, single } = await detectFieldNames(token);

  // Common Apify Google SERP inputs — extra fields are ignored by the actor.
  const commonInput: Record<string, unknown> = {
    countryCode: country,
    languageCode: language,
    country,
    language,
    resultsPerPage: resultsPerQuery,
    maxPagesPerQuery: 1,
    resultsPerQuery,
    maxItems: resultsPerQuery,
  };

  const attempt = async (queriesInRun: string[]): Promise<DatasetItem[]> => {
    const input: Record<string, unknown> = { ...commonInput };
    if (multi) input[multi] = queriesInRun;
    if (single && queriesInRun.length === 1) input[single] = queriesInRun[0];
    // Some actors want a newline-joined string in `queries`.
    if (!multi && !single) input.queries = queriesInRun.join("\n");
    try {
      return await runOnce(token, input, timeoutMs);
    } catch (e) {
      const err = e as Error & { retriable?: boolean };
      if (err.retriable || err.name === "AbortError") {
        // One retry on 5xx / timeout.
        return await runOnce(token, input, timeoutMs);
      }
      throw err;
    }
  };

  const items = multi
    ? await attempt(clean)
    : (
        await Promise.all(clean.map((q) => attempt([q]).catch(() => [] as DatasetItem[])))
      ).flat();

  // Map items → buckets in the requested order.
  const byQuery = new Map<string, SerpBucket>();
  clean.forEach((q, idx) => {
    // Try to align each item to a query — the actor usually echoes it.
    const raw = items[idx] ?? items.find((it) => {
      const bucket = normalizeItem(it, q);
      return bucket.query.trim().toLowerCase() === q.trim().toLowerCase();
    });
    const bucket = raw ? normalizeItem(raw, q) : { query: q, results: [] };
    if (!byQuery.has(q)) byQuery.set(q, bucket);
  });
  return clean.map((q) => byQuery.get(q) ?? { query: q, results: [] });
}

export async function serpHealthCheck(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const [b] = await runSerpSearch(["test PL support"], { resultsPerQuery: 10, timeoutMs: 45_000 });
    return { ok: (b?.results.length ?? 0) > 0, count: b?.results.length ?? 0 };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Rich connection test used by the settings UI: returns the top-5 results
 * so the user can visually confirm PL locale + real Google output.
 */
export async function serpSampleQuery(
  query: string,
): Promise<{ ok: boolean; count: number; results: SerpResult[]; error?: string }> {
  try {
    const q = query.trim() || "kawa arabica sklep";
    const [b] = await runSerpSearch([q], { resultsPerQuery: 20, timeoutMs: 45_000 });
    const results = (b?.results ?? []).slice(0, 5);
    return { ok: results.length > 0, count: b?.results.length ?? 0, results };
  } catch (e) {
    return { ok: false, count: 0, results: [], error: e instanceof Error ? e.message : String(e) };
  }
}