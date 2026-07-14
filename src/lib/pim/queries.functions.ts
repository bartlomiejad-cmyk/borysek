import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeGoldenDescriptionHtml } from "./seo";
import { type ImageMeta, pickThumbsForList } from "./images";

export const listProductsWithEnrichment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: products, error } = await supabase
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);
    const ids = (products ?? []).map((p) => p.id);
    if (!ids.length) return [];
    const { data: ens } = await supabase
      .from("enrichments")
      .select(
        "id, source_product_id, status, match_type, picked_urls, golden_name, generated_at, error, hidden_images, golden_features, quality, image_meta, pinned_main_url, regenerated_main_image, ai_gallery_urls, golden_slug, golden_meta_description, golden_seo_keywords, score_breakdown, rescrape_rounds, data_sufficiency",
      )
      .eq("project_id", data.projectId)
      .limit(10000);
    type EnrichRow = NonNullable<typeof ens>[number];
    const enMap = new Map<string, EnrichRow>();
    for (const e of ens ?? []) enMap.set(e.source_product_id, e);

    // Pull ALL product_sources for the project in one shot. Filtering by
    // .in("url", [...thousands of urls]) blows up the PostgREST URL length
    // and silently returns nothing, leaving the list with no thumbnails.
    const imgMap = new Map<string, string[]>();
    const extraSet = new Set<string>();
    // PostgREST caps a single response at 1000 rows even when .limit() is larger,
    // so we paginate via .range() to fetch every product_source for the project.
    const PAGE = 1000;
    const allSrcs: Array<{ url: string; images: unknown; extra_images?: unknown }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: srcErr } = await supabase
        .from("product_sources")
        .select("url, images, extra_images")
        .eq("project_id", data.projectId)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (srcErr) { console.error("product_sources fetch failed:", srcErr.message); break; }
      if (!page || page.length === 0) break;
      allSrcs.push(...page);
      if (page.length < PAGE) break;
    }
    for (const s of allSrcs) {
      const main = Array.isArray(s.images) ? (s.images as string[]) : [];
      const extra = Array.isArray((s as { extra_images?: unknown }).extra_images)
        ? ((s as { extra_images: string[] }).extra_images)
        : [];
      for (const u of extra) extraSet.add(u);
      imgMap.set(s.url, [...main, ...extra]);
    }

    return (products ?? []).map((p) => {
      const e = enMap.get(p.id);
      const picked = (e?.picked_urls as string[] | undefined) ?? [];
      const hidden = new Set(((e as { hidden_images?: string[] } | undefined)?.hidden_images ?? []) as string[]);
      const meta = ((e as unknown as { image_meta?: ImageMeta } | undefined)?.image_meta ?? {}) as ImageMeta;
      const pinned = ((e as { pinned_main_url?: string | null } | undefined)?.pinned_main_url ?? null) as string | null;
      const allFromSources: string[] = [];
      for (const u of picked) {
        for (const img of imgMap.get(u) ?? []) {
          if (!allFromSources.includes(img)) allFromSources.push(img);
        }
      }
      const images = pickThumbsForList(allFromSources, meta, hidden, pinned, 12);
      return {
        ...p,
        status: e?.status ?? "PENDING",
        match_type: e?.match_type ?? "NO_MATCH",
        golden_name: e?.golden_name ?? null,
        generated_at: e?.generated_at ?? null,
        error: e?.error ?? null,
        thumbnail: images[0] ?? null,
        images,
        extra_image_urls: images.filter((u) => extraSet.has(u)),
        picked_urls: picked,
        enrichment_id: (e as { id?: string } | undefined)?.id ?? null,
        pinned_main_url: pinned,
        regenerated_main_image: ((e as { regenerated_main_image?: string | null } | undefined)?.regenerated_main_image ?? null) as string | null,
        ai_gallery_urls: (((e as { ai_gallery_urls?: string[] } | undefined)?.ai_gallery_urls) ?? []) as string[],
        golden_features: ((e as { golden_features?: unknown } | undefined)?.golden_features ?? []) as Array<{ key: string; value: string }>,
        golden_slug: ((e as { golden_slug?: string | null } | undefined)?.golden_slug ?? null) as string | null,
        golden_meta_description: ((e as { golden_meta_description?: string | null } | undefined)?.golden_meta_description ?? null) as string | null,
        golden_seo_keywords: (((e as { golden_seo_keywords?: unknown } | undefined)?.golden_seo_keywords ?? []) as string[]),
        quality: ((e as { quality?: unknown } | undefined)?.quality ?? null) as unknown as null | {
          watermark_urls?: string[];
          name_mismatch?: boolean;
          feature_mismatches?: string[];
          notes?: string;
        },
        score_breakdown: (((e as { score_breakdown?: unknown } | undefined)?.score_breakdown) ?? []) as Array<{
          url: string;
          total: number;
          producer_boost: boolean;
          trusted_boost: boolean;
        }>,
        rescrape_rounds: (((e as { rescrape_rounds?: number } | undefined)?.rescrape_rounds) ?? 0) as number,
        data_sufficiency:
          ((e as { data_sufficiency?: "full" | "partial" | "poor" | null } | undefined)
            ?.data_sufficiency ?? null) as "full" | "partial" | "poor" | null,
      };
    });
  });

export const getProductDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ projectId: z.string().uuid(), productId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("include_extra_images")
      .eq("id", data.projectId)
      .single();
    const includeExtra = (project as { include_extra_images?: boolean } | null)?.include_extra_images ?? false;

    const { data: product, error } = await supabase
      .from("source_products")
      .select("*")
      .eq("id", data.productId)
      .single();
    if (error || !product) throw new Error(error?.message ?? "Not found");
    const { data: enrichment } = await supabase
      .from("enrichments")
      .select("*")
      .eq("source_product_id", data.productId)
      .maybeSingle();
    const picked = ((enrichment?.picked_urls as string[] | null) ?? []);
    const hidden = new Set(((enrichment as { hidden_images?: string[] } | null)?.hidden_images ?? []) as string[]);
    const meta = ((enrichment as unknown as { image_meta?: ImageMeta } | null)?.image_meta ?? {}) as ImageMeta;
    const scoresEarly = ((enrichment as unknown as { image_scores?: Record<string, { is_banner_or_trash?: boolean; identity?: string; manual_keep?: boolean }> } | null)?.image_scores ?? {}) as Record<string, { is_banner_or_trash?: boolean; identity?: string; manual_keep?: boolean }>;
    const trash = new Set<string>(
      Object.entries(scoresEarly)
        .filter(([, s]) => {
          if (!s) return false;
          if (s.manual_keep === true) return false;
          if (s.is_banner_or_trash === true) return true;
          if (s.identity === "different") return true;
          return false;
        })
        .map(([u]) => u),
    );
    let sources: Array<{
      url: string;
      title: string | null;
      description: string | null;
      images: string[];
      extra_images: string[];
      cleaning_meta: {
        cleaned_by: "llm" | "regex";
        confidence: number | null;
        removed_sections: string[];
      } | null;
    }> = [];
    if (picked.length) {
      const { data: srcs, error: srcErr } = await supabase
        .from("product_sources")
        .select("url, title, description, images, extra_images, cleaning_meta")
        .eq("project_id", data.projectId)
        .in("url", picked);
      if (srcErr) console.error("product_sources fetch failed:", srcErr.message);
      const byUrl = new Map(srcs?.map((s) => [s.url, s]) ?? []);
      // Global pick across all sources, so per-source filtering uses the
      // single best fallback rather than keeping a small image per source.
      const allMain: string[] = [];
      const allExtra: string[] = [];
      for (const s of srcs ?? []) {
        for (const u of (Array.isArray(s.images) ? (s.images as string[]) : [])) if (!allMain.includes(u)) allMain.push(u);
        const ex = Array.isArray((s as { extra_images?: unknown }).extra_images) ? ((s as { extra_images: string[] }).extra_images) : [];
        for (const u of ex) if (!allExtra.includes(u)) allExtra.push(u);
      }
      // Gallery shows everything the list shows: drop only hidden URLs.
      // Strict size filtering is reserved for export.
      const allowedMain = new Set(allMain.filter((u) => !hidden.has(u) && !trash.has(u)));
      const allowedExtra = new Set(
        includeExtra ? allExtra.filter((u) => !hidden.has(u) && !trash.has(u)) : [],
      );
      sources = picked.map((u) => {
        const s = byUrl.get(u);
        const main = Array.isArray(s?.images) ? (s!.images as string[]) : [];
        const extra = Array.isArray((s as { extra_images?: unknown } | undefined)?.extra_images)
          ? ((s as { extra_images: string[] }).extra_images)
          : [];
        const cleaning_meta = ((s as { cleaning_meta?: unknown } | undefined)?.cleaning_meta ?? null) as
          | { cleaned_by: "llm" | "regex"; confidence: number | null; removed_sections: string[] }
          | null;
        return {
          url: u,
          title: s?.title ?? null,
          description: s?.description ?? null,
          images: main.filter((img) => allowedMain.has(img)),
          extra_images: includeExtra ? extra.filter((img) => allowedExtra.has(img)) : [],
          cleaning_meta,
        };
      });
    }
    const image_scores = ((enrichment as unknown as { image_scores?: Record<string, { is_central: number; is_clean: number; is_banner_or_trash: boolean; identity?: "same" | "different" | "unsure"; manual_keep?: boolean; scored_at?: string }> } | null)?.image_scores ?? {}) as Record<string, { is_central: number; is_clean: number; is_banner_or_trash: boolean; identity?: "same" | "different" | "unsure"; manual_keep?: boolean; scored_at?: string }>;
    const rejected_identity_images = Object.entries(image_scores)
      .filter(([, s]) => s?.identity === "different" && s?.manual_keep !== true)
      .map(([u]) => u);
    return {
      product,
      enrichment,
      sources,
      hidden_images: Array.from(hidden),
      include_extra_images: includeExtra,
      image_meta: meta,
      image_scores,
      rejected_identity_images,
      pinned_main_url: ((enrichment as { pinned_main_url?: string | null } | null)?.pinned_main_url ?? null) as string | null,
    };
  });

export const updateGoldenRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      enrichmentId: z.string().uuid(),
      golden_name: z.string().max(500).nullable().optional(),
      golden_description: z.string().max(20000).nullable().optional(),
      golden_slug: z.string().max(200).nullable().optional(),
      golden_meta_description: z.string().max(400).nullable().optional(),
      golden_seo_keywords: z.array(z.string().max(120)).max(20).nullable().optional(),
      allegro_description: z.string().max(60000).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: Record<string, unknown> = {};
    if (data.golden_name !== undefined) patch.golden_name = data.golden_name;
    if (data.golden_description !== undefined) {
      patch.golden_description = data.golden_description == null
        ? null
        : sanitizeGoldenDescriptionHtml(data.golden_description, { name: data.golden_name ?? null });
    }
    if (data.golden_slug !== undefined) patch.golden_slug = data.golden_slug ?? null;
    if (data.golden_meta_description !== undefined) patch.golden_meta_description = data.golden_meta_description ?? null;
    if (data.golden_seo_keywords !== undefined) patch.golden_seo_keywords = data.golden_seo_keywords ?? null;
    if (data.allegro_description !== undefined) {
      const { sanitizeAllegroDescriptionHtml } = await import("./seo");
      patch.allegro_description = data.allegro_description == null
        ? null
        : sanitizeAllegroDescriptionHtml(data.allegro_description);
      patch.allegro_generated_at = new Date().toISOString();
    }
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await supabase
      .from("enrichments")
      .update(patch as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Manually override an image identity verdict from the product editor:
 * setting `keep: true` flips `image_scores[url].manual_keep = true`, which
 * wins over any AI-set `is_banner_or_trash` / `identity: 'different'`.
 * Setting `keep: false` clears the override.
 */
export const setImageManualKeep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      productId: z.string().uuid(),
      url: z.string().url(),
      keep: z.boolean(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: enr, error } = await supabase
      .from("enrichments")
      .select("id, image_scores")
      .eq("source_product_id", data.productId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!enr) throw new Error("Enrichment not found");
    const scores = (((enr as unknown as { image_scores?: Record<string, Record<string, unknown>> }).image_scores) ?? {}) as Record<string, Record<string, unknown>>;
    const prev = scores[data.url] ?? {};
    const next = { ...prev };
    if (data.keep) next.manual_keep = true;
    else delete next.manual_keep;
    scores[data.url] = next;
    const { error: upErr } = await supabase
      .from("enrichments")
      .update({ image_scores: scores as never } as never)
      .eq("id", (enr as unknown as { id: string }).id);
    if (upErr) throw new Error(upErr.message);
    return { ok: true, manual_keep: data.keep };
  });
