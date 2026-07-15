/**
 * Single choke point for every external call that sends product image URLs
 * (vision analysis, consistency check, FAL refs, QC). Guarantees:
 *
 *  - Only http(s) URLs pass.
 *  - Any URL that equals a known `product_sources.url` for this project is
 *    rejected (those are PAGE URLs — feeding them to Gemini returns
 *    "URL did not return an image", which then loops the whole viz job).
 *  - URLs already marked dead in `image_scores` are dropped.
 *  - Unprobed URLs get a 5s HEAD/GET probe on the spot; failures are marked
 *    `dead:true` in `image_scores` so the next tick skips them.
 *
 * Callers pass the raw candidate list and get back the sanitized subset.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { probeImageUrls } from "./image-probe.server";

type ImageScoreEntry = {
  dead?: boolean;
  w?: number | null;
  h?: number | null;
  content_type?: string | null;
};

export async function sanitizeImageInputs(args: {
  projectId: string;
  enrichmentId: string;
  candidates: readonly string[];
  imageScores?: Record<string, ImageScoreEntry | undefined> | null;
}): Promise<string[]> {
  const seen = new Set<string>();
  const httpish: string[] = [];
  for (const raw of args.candidates) {
    if (!raw || typeof raw !== "string") continue;
    const u = raw.trim();
    if (!/^https?:\/\//i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    httpish.push(u);
  }
  if (!httpish.length) return [];

  // Reject anything that matches a known source PAGE URL for the project.
  const { data: pageRows } = await supabaseAdmin
    .from("product_sources")
    .select("url")
    .eq("project_id", args.projectId)
    .in("url", httpish);
  const pageUrlSet = new Set<string>(
    ((pageRows ?? []) as Array<{ url?: string | null }>).flatMap((r) =>
      r.url ? [r.url] : [],
    ),
  );

  const scores = (args.imageScores ?? {}) as Record<string, ImageScoreEntry | undefined>;
  const alive: string[] = [];
  const needProbe: string[] = [];
  for (const u of httpish) {
    if (pageUrlSet.has(u)) continue;
    const s = scores[u];
    if (s?.dead === true) continue;
    if (s && ((typeof s.w === "number" && (s.w ?? 0) > 0) ||
              (typeof s.content_type === "string" && /^image\//i.test(s.content_type)))) {
      alive.push(u);
    } else {
      needProbe.push(u);
    }
  }

  if (needProbe.length) {
    const { alive: probeAlive, dead: probeDead } = await probeImageUrls(needProbe, {
      timeoutMs: 5000,
      concurrency: 6,
    });
    for (const u of probeAlive) alive.push(u);
    if (probeDead.length) {
      await markDead(args.enrichmentId, probeDead);
    }
  }

  // Preserve original candidate order.
  const order = new Map<string, number>();
  httpish.forEach((u, i) => order.set(u, i));
  alive.sort((a, b) => (order.get(a)! - order.get(b)!));
  return alive;
}

/**
 * Called from retry paths when the AI Gateway rejects a specific URL with
 * "did not return an image": mark it dead + remove it from the payload.
 * Returns the reduced URL list (never retries with the identical set).
 */
export async function dropDeadUrls(
  enrichmentId: string,
  urls: readonly string[],
  deadUrls: readonly string[],
): Promise<string[]> {
  const bad = new Set(deadUrls);
  await markDead(enrichmentId, [...bad]);
  return urls.filter((u) => !bad.has(u));
}

async function markDead(enrichmentId: string, urls: readonly string[]): Promise<void> {
  if (!urls.length) return;
  const { data: row } = await supabaseAdmin
    .from("enrichments")
    .select("image_scores")
    .eq("id", enrichmentId)
    .maybeSingle();
  const scores = ((row as { image_scores?: Record<string, ImageScoreEntry> } | null)?.image_scores
    ?? {}) as Record<string, ImageScoreEntry>;
  const next = { ...scores };
  for (const u of urls) {
    next[u] = { ...(next[u] ?? {}), dead: true };
  }
  await supabaseAdmin
    .from("enrichments")
    .update({ image_scores: next as never } as never)
    .eq("id", enrichmentId)
    .then(() => undefined, () => undefined);
}

/** Best-effort test whether a Gateway error is "URL did not return an image" */
export function extractOffendingUrl(errorMessage: string): string | null {
  const m = errorMessage.match(/https?:\/\/[^\s)"']+/);
  return m ? m[0] : null;
}

export function isNotAnImageError(errorMessage: string): boolean {
  return /did not return an image|received text\/|received html/i.test(errorMessage);
}