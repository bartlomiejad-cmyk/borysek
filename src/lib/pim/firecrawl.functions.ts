import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Marketplace / aggregator domains we never want as scraped sources.
 * Listings on these sites are noisy and rarely give us a single canonical
 * product description. Per-project blacklist is applied on top of this.
 */
export const MARKETPLACE_DOMAINS: string[] = [
  "amazon.",
  "allegro.pl",
  "allegrolokalnie.pl",
  "ebay.",
  "aliexpress.",
  "alibaba.",
  "olx.pl",
  "ceneo.pl",
  "skapiec.pl",
  "nokaut.pl",
  "okazje.info.pl",
  "google.",
  "youtube.",
  "facebook.",
  "instagram.",
  "tiktok.",
  "pinterest.",
  "reddit.",
  "wikipedia.",
  "twitter.",
  "x.com",
  "temu.com",
  "shein.",
  "wish.com",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isMarketplaceUrl(url: string, extraBlacklist: string[] = []): boolean {
  const host = hostOf(url);
  if (!host) return true;
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (/\/(forum|blog|news|wiadomosci|artykul|opinie|recenzje)\b/i.test(path)) return true;
  const all = [...MARKETPLACE_DOMAINS, ...extraBlacklist.map((d) => d.toLowerCase().trim()).filter(Boolean)];
  for (const d of all) {
    if (!d) continue;
    if (host === d || host.endsWith(`.${d}`) || host.includes(d)) return true;
  }
  return false;
}

export const startFirecrawlDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        onlyMissing: z.boolean().default(true),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Block if a discovery job is already running.
    const { data: existing } = await supabase
      .from("bulk_jobs" as never)
      .select("id")
      .eq("project_id", data.projectId)
      .eq("kind", "FIRECRAWL_DISCOVERY")
      .in("status", ["PENDING", "PROCESSING"])
      .maybeSingle();
    if (existing) {
      throw new Error("Wyszukiwanie źródeł już działa w tle dla tego projektu.");
    }

    // Pick target products.
    const { data: products, error } = await supabase
      .from("source_products")
      .select("id, nazwa")
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);

    let targetIds = (products ?? [])
      .filter((p) => (p.nazwa ?? "").trim().length > 0)
      .map((p) => p.id as string);

    if (data.onlyMissing && targetIds.length) {
      const { data: existingSrs } = await supabase
        .from("search_results")
        .select("term")
        .eq("project_id", data.projectId);
      const haveTerms = new Set(
        (existingSrs ?? []).map((s) => (s.term ?? "").trim().toLowerCase()),
      );
      const namesById = new Map((products ?? []).map((p) => [p.id as string, (p.nazwa ?? "").trim().toLowerCase()]));
      targetIds = targetIds.filter((id) => {
        const t = namesById.get(id) ?? "";
        return t && !haveTerms.has(t);
      });
    }

    if (!targetIds.length) {
      throw new Error("Brak produktów do przetworzenia (wszystkie mają już źródła lub brak nazwy).");
    }

    const { data: row, error: insErr } = await supabase
      .from("bulk_jobs" as never)
      .insert({
        project_id: data.projectId,
        user_id: userId,
        kind: "FIRECRAWL_DISCOVERY",
        items: targetIds as never,
        total: targetIds.length,
      } as never)
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    // Kick the worker immediately; cron picks up otherwise.
    try {
      const base =
        process.env.PUBLIC_APP_URL ||
        "https://project--a56746f2-6fdf-47b1-8095-043a41af98fd.lovable.app";
      const apikey = process.env.SUPABASE_PUBLISHABLE_KEY;
      if (apikey) {
        void fetch(`${base}/api/public/hooks/process-bulk-jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey },
          body: "{}",
        }).catch(() => {});
      }
    } catch {
      // ignore
    }

    return { jobId: (row as { id: string }).id, total: targetIds.length };
  });