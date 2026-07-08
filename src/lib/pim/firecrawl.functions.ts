import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { filterImageUrls, sanitizeProductDescription } from "./source-cleanup";

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
        productIds: z.array(z.string().uuid()).max(20000).optional(),
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

    const restrict = data.productIds ? new Set(data.productIds) : null;
    let targetIds = (products ?? [])
      .filter((p) => (p.nazwa ?? "").trim().length > 0)
      .filter((p) => (restrict ? restrict.has(p.id as string) : true))
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

/**
 * Reklean istniejących product_sources — deterministyczne sito (logo Blika,
 * Bazant, ikony kontaktu, stopkowe frazy) bez ponownego scrape'u przez
 * Firecrawl. Działa wyłącznie na zapisanych już danych. Ownership via RLS.
 */
export const recleanProductSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ projectId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("product_sources")
      .select("id, images, extra_images, description")
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);

    // Zbierz URL-e oznaczone wcześniej przez AI jako baner/śmieć.
    const { data: ens } = await supabase
      .from("enrichments")
      .select("image_scores")
      .eq("project_id", data.projectId);
    const trashUrls = new Set<string>();
    for (const e of ens ?? []) {
      const scores = (e as { image_scores?: Record<string, { is_banner_or_trash?: boolean }> } | null)?.image_scores ?? {};
      for (const [u, s] of Object.entries(scores)) {
        if (s && s.is_banner_or_trash === true) trashUrls.add(u);
      }
    }
    let scanned = 0;
    let updated = 0;
    let imagesRemoved = 0;
    let charsRemoved = 0;

    for (const row of rows ?? []) {
      scanned++;
      const r = row as {
        id: string;
        images: unknown;
        extra_images: unknown;
        description: string | null;
      };
      const mainIn = Array.isArray(r.images) ? (r.images as string[]) : [];
      const extraIn = Array.isArray(r.extra_images) ? (r.extra_images as string[]) : [];
      const mainOut = filterImageUrls(mainIn).filter((u) => !trashUrls.has(u));
      const extraOut = filterImageUrls(extraIn).filter((u) => !trashUrls.has(u));
      const descIn = r.description ?? "";
      const descOut = sanitizeProductDescription(descIn);

      const dImages = mainIn.length - mainOut.length + (extraIn.length - extraOut.length);
      const dChars = Math.max(0, descIn.length - descOut.length);

      if (dImages === 0 && dChars === 0) continue;

      const { error: uErr } = await supabase
        .from("product_sources")
        .update({
          images: mainOut as never,
          extra_images: extraOut as never,
          description: descOut || null,
        } as never)
        .eq("id", r.id);
      if (uErr) throw new Error(uErr.message);

      updated++;
      imagesRemoved += dImages;
      charsRemoved += dChars;
    }

    return { scanned, updated, imagesRemoved, charsRemoved };
  });