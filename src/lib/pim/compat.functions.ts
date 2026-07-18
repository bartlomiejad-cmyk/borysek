import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { advancePipelineStatus, setManualLockOnProduct } from "./pipeline-status";
import { scoreAndCapForProduct } from "./matching.functions";

type BreakdownEntry = {
  url: string;
  total: number;
  producer_boost: boolean;
  trusted_boost: boolean;
  variant_key: string | null;
  deduped: boolean;
  ean_confirmed?: boolean;
  manual?: boolean;
};

/**
 * Toggle matching_mode ('strict' | 'compatible') on one or more products.
 * Setting mode='compatible' also clears the compat_suggested hint for the
 * affected enrichments so the "przełącz tryb" badge disappears from the UI.
 */
export const setMatchingMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        productIds: z.array(z.string().uuid()).min(1).max(2000),
        mode: z.enum(["strict", "compatible"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("source_products")
      .update({ matching_mode: data.mode } as never)
      .in("id", data.productIds);
    if (error) throw new Error(error.message);
    if (data.mode === "compatible") {
      await supabase
        .from("enrichments")
        .update({ compat_suggested: false } as never)
        .in("source_product_id", data.productIds);
    }
    return { ok: true, updated: data.productIds.length };
  });

/**
 * Re-run single-product source scoring (with the currently-selected
 * matching_mode) even when manual_lock is set. Intended for the compat-hint
 * "przełącz tryb i dopasuj ponownie" one-click action.
 */
export const rerunMatchingForProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        productId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: product, error: pErr } = await supabase
      .from("source_products")
      .select("id, project_id")
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error("Produkt nie znaleziony lub brak dostępu");
    if ((product as { project_id: string }).project_id !== data.projectId) {
      throw new Error("Produkt nie należy do projektu");
    }
    const apiKey = process.env.LOVABLE_API_KEY;
    const res = await scoreAndCapForProduct(data.projectId, data.productId, apiKey, {
      force: true,
    });
    return res;
  });

/**
 * Attach 1..5 URLs manually to a product's enrichment. Each URL is scraped
 * via the shared Firecrawl scrape+AI-filter path (idempotent upsert into
 * product_sources), added to enrichments.picked_urls, tagged in
 * score_breakdown with { manual: true }, and the product is manual-locked so
 * subsequent matching runs cannot drop the manual sources.
 */
export const attachManualSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        productId: z.string().uuid(),
        urls: z.array(z.string().url()).min(1).max(5),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY nie jest skonfigurowane");
    const aiKey = process.env.LOVABLE_API_KEY;

    const { data: product, error: pErr } = await supabase
      .from("source_products")
      .select("id, project_id, nazwa, kod, ean")
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");
    if ((product as { project_id: string }).project_id !== data.projectId) {
      throw new Error("Product does not belong to project");
    }

    // Dedupe input URLs.
    const seen = new Set<string>();
    const cleanUrls = data.urls
      .map((u) => u.trim())
      .filter((u) => {
        if (!u || seen.has(u)) return false;
        seen.add(u);
        return true;
      });

    // Dynamic import — worker helpers live in a .server.ts module and must
    // never be part of the client bundle graph.
    const [{ scrapeAndStoreSource }, FirecrawlMod] = await Promise.all([
      import("./_workers.server"),
      import("@mendable/firecrawl-js"),
    ]);
    const Firecrawl = FirecrawlMod.default;
    const firecrawl = new Firecrawl({ apiKey });

    const scrapedOk: string[] = [];
    const failed: Array<{ url: string; reason: string }> = [];
    for (const url of cleanUrls) {
      try {
        const res = await scrapeAndStoreSource(
          firecrawl,
          aiKey,
          {
            id: product.id,
            project_id: product.project_id,
            nazwa: product.nazwa ?? null,
            kod: product.kod ?? null,
            ean: product.ean ?? null,
          },
          url,
          undefined,
        );
        if (res.ok) scrapedOk.push(url);
        else failed.push({ url, reason: "AI odrzuciło stronę (nie wygląda na kartę produktu)" });
      } catch (e) {
        failed.push({ url, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    if (!scrapedOk.length) {
      return { ok: false, added: 0, failed };
    }

    // A manually attached, successfully scraped source is enough to bring the
    // product back into the pipeline regardless of whether the auto-exclusion
    // was set. Manual exclusion is intentionally left alone here — the user
    // must lift it explicitly.
    try {
      await supabase
        .from("source_products")
        .update({ excluded: false, excluded_reason: null, excluded_at: null } as never)
        .eq("id", data.productId)
        .eq("excluded_reason", "auto_no_sources");
    } catch { /* non-fatal */ }

    // Upsert enrichment row if missing, then union picked_urls and record
    // manual breakdown entries.
    const { data: enRow } = await supabase
      .from("enrichments")
      .select("id, picked_urls, score_breakdown")
      .eq("source_product_id", data.productId)
      .maybeSingle();

    const currentPicked = ((enRow as { picked_urls?: string[] | null } | null)?.picked_urls ?? []) as string[];
    const currentBd = (Array.isArray((enRow as { score_breakdown?: unknown } | null)?.score_breakdown)
      ? ((enRow as unknown as { score_breakdown: BreakdownEntry[] }).score_breakdown)
      : []) as BreakdownEntry[];

    const bdByUrl = new Map(currentBd.map((b) => [b.url, b]));
    for (const u of scrapedOk) {
      const prev = bdByUrl.get(u);
      if (prev) {
        bdByUrl.set(u, { ...prev, manual: true });
      } else {
        bdByUrl.set(u, {
          url: u,
          total: 0,
          producer_boost: false,
          trusted_boost: false,
          variant_key: null,
          deduped: false,
          manual: true,
        });
      }
    }
    const newBd = Array.from(bdByUrl.values());
    const newPicked = Array.from(new Set([...scrapedOk, ...currentPicked]));

    if (enRow) {
      const { error: upErr } = await supabase
        .from("enrichments")
        .update({
          picked_urls: newPicked as never,
          score_breakdown: newBd as never,
          status: "MATCHED",
          compat_suggested: false,
        } as never)
        .eq("id", (enRow as { id: string }).id);
      if (upErr) throw new Error(upErr.message);
    } else {
      const { error: insErr } = await supabase
        .from("enrichments")
        .insert({
          project_id: data.projectId,
          source_product_id: data.productId,
          picked_urls: newPicked as never,
          score_breakdown: newBd as never,
          status: "MATCHED",
          match_type: "NAME_MATCH",
        } as never);
      if (insErr) throw new Error(insErr.message);
    }

    await setManualLockOnProduct(supabase as never, data.productId, true);
    await advancePipelineStatus(supabase as never, data.productId, "MATCHED");

    return { ok: true, added: scrapedOk.length, failed };
  });

/**
 * Remove a picked source URL from a product's enrichment. The URL is:
 *   - dropped from `enrichments.picked_urls`
 *   - dropped from `enrichments.score_breakdown`
 *   - tracked in `enrichments.removed_urls` so subsequent re-runs of
 *     discovery/matching skip it as user-rejected.
 * The scraped `product_sources` row is kept (idempotent cache).
 */
export const removePickedSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        productId: z.string().uuid(),
        url: z.string().url(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: enRow, error } = await supabase
      .from("enrichments")
      .select("id, picked_urls, score_breakdown, removed_urls")
      .eq("source_product_id", data.productId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!enRow) return { ok: false, reason: "no_enrichment" };
    const row = enRow as {
      id: string;
      picked_urls: string[] | null;
      score_breakdown: BreakdownEntry[] | null;
      removed_urls: string[] | null;
    };
    const picked = (row.picked_urls ?? []).filter((u) => u !== data.url);
    const bd = (row.score_breakdown ?? []).filter((b) => b.url !== data.url);
    const removed = Array.from(new Set([...(row.removed_urls ?? []), data.url]));
    const { error: upErr } = await supabase
      .from("enrichments")
      .update({
        picked_urls: picked as never,
        score_breakdown: bd as never,
        removed_urls: removed as never,
      } as never)
      .eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
    return { ok: true, removed_url: data.url, remaining: picked.length };
  });