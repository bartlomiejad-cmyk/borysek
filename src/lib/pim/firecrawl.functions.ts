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
        // Retained for backward compatibility. Kept as no-op flag: eligibility
        // is now driven strictly by pipeline_status (IMPORTED) or an explicit
        // productIds selection. The old semantics ("skip products that
        // already have a search_results row") caused a mismatch with the
        // pipeline stage bar and made cleared-source products un-startable.
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

    // Pick target products. Eligibility rules:
    //   • If productIds is passed → those exact products (explicit user
    //     selection, e.g. "Szukaj ponownie" from editor). Works at any
    //     pipeline_status — idempotent, new results merge into search_results.
    //   • Otherwise → products at the Import stage
    //     (pipeline_status IS NULL OR = 'IMPORTED').
    // The old "skip if search_results row exists" predicate is removed:
    // it disagreed with the pipeline stage bar for products whose sources
    // had been cleared.
    const { data: products, error } = await supabase
      .from("source_products")
      .select("id, nazwa, pipeline_status")
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);

    const restrict = data.productIds ? new Set(data.productIds) : null;
    const scoped = (products ?? []).filter((p) =>
      restrict ? restrict.has(p.id as string) : true,
    );

    let skippedAdvanced = 0;
    let skippedNoName = 0;
    const targetIds: string[] = [];
    for (const p of scoped) {
      const name = (p.nazwa ?? "").trim();
      if (!name) {
        skippedNoName++;
        continue;
      }
      if (!restrict) {
        const ps = ((p as { pipeline_status?: string | null }).pipeline_status ?? "IMPORTED") as string;
        if (ps !== "IMPORTED") {
          skippedAdvanced++;
          continue;
        }
      }
      targetIds.push(p.id as string);
    }

    if (!targetIds.length) {
      throw new Error(
        `Brak produktów do przetworzenia: ${skippedAdvanced} pominięto (status dalej niż Import), ${skippedNoName} pominięto (brak nazwy).`,
      );
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
      const { kickBulkWorker } = await import("./worker-kick.server");
      kickBulkWorker();
    } catch {
      // ignore
    }

    return {
      jobId: (row as { id: string }).id,
      total: targetIds.length,
      skippedAdvanced,
      skippedNoName,
    };
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
      const scores = (e as { image_scores?: Record<string, { is_banner_or_trash?: boolean; identity?: string; manual_keep?: boolean }> } | null)?.image_scores ?? {};
      for (const [u, s] of Object.entries(scores)) {
        if (!s) continue;
        if (s.manual_keep === true) continue; // user override — never drop
        if (s.is_banner_or_trash === true) trashUrls.add(u);
        else if (s.identity === "different") trashUrls.add(u);
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

/**
 * Pełny reset stanu wyszukiwania dla produktu/projektu:
 *  • usuwa wpisy `search_results` dla objętych produktów (po `term`,
 *    w ramach projektu, tylko jeśli dany term nie jest używany przez
 *    inny produkt spoza selekcji),
 *  • czyści discovery-related pola w `enrichments` (picked_urls,
 *    matched_term, status, image_scores, hidden_images, image_meta,
 *    score_breakdown, quality, error),
 *  • ustawia `pipeline_status = 'IMPORTED'`.
 * Nie modyfikuje: `manual_lock`, `review_status`, `approved_at`,
 * `approved_by`, notatek klienta, audytu, ani ręcznych override'ów
 * (np. `viz_analysis` z flagą `manual = true` — po prostu nie ruszamy
 * tego pola).
 */
export const resetProductSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        productIds: z.array(z.string().uuid()).max(20000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: products, error } = await supabase
      .from("source_products")
      .select("id, nazwa")
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);

    const restrict = data.productIds ? new Set(data.productIds) : null;
    const targeted = (products ?? []).filter((p) =>
      restrict ? restrict.has(p.id as string) : true,
    );
    const untargeted = (products ?? []).filter((p) =>
      restrict ? !restrict.has(p.id as string) : false,
    );

    const norm = (s: string | null | undefined) =>
      (s ?? "").trim().toLowerCase();

    const targetedTerms = new Set(
      targeted.map((p) => norm(p.nazwa)).filter((t) => t.length > 0),
    );
    const sharedTerms = new Set(
      untargeted.map((p) => norm(p.nazwa)).filter((t) => targetedTerms.has(t)),
    );
    const deletableTerms = [...targetedTerms].filter((t) => !sharedTerms.has(t));

    let deletedSearchRows = 0;
    if (deletableTerms.length) {
      // Match case-insensitively (search_results.term is stored trimmed +
      // lowercased by the worker; existing rows might not be, so we do a
      // per-term delete with ilike).
      for (const term of deletableTerms) {
        const { data: del, error: dErr } = await supabase
          .from("search_results")
          .delete()
          .eq("project_id", data.projectId)
          .ilike("term", term)
          .select("id");
        if (dErr) throw new Error(dErr.message);
        deletedSearchRows += (del ?? []).length;
      }
    }

    const targetedIds = targeted.map((p) => p.id as string);
    let enrichmentsReset = 0;
    if (targetedIds.length) {
      const { data: upd, error: uErr } = await supabase
        .from("enrichments")
        .update({
          picked_urls: [] as never,
          matched_term: null,
          status: null,
          image_scores: {} as never,
          hidden_images: [] as never,
          image_meta: {} as never,
          score_breakdown: null,
          quality: null,
          error: null,
        } as never)
        .in("source_product_id", targetedIds)
        .eq("project_id", data.projectId)
        .select("source_product_id");
      if (uErr) throw new Error(uErr.message);
      enrichmentsReset = (upd ?? []).length;

      const { error: spErr } = await supabase
        .from("source_products")
        .update({ pipeline_status: "IMPORTED" } as never)
        .in("id", targetedIds)
        .eq("project_id", data.projectId);
      if (spErr) throw new Error(spErr.message);
    }

    return {
      products: targetedIds.length,
      deletedSearchRows,
      enrichmentsReset,
    };
  });