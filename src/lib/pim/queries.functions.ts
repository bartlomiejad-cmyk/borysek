import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type ImageMeta } from "./images";

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
        "id, source_product_id, status, match_type, picked_urls, golden_name, generated_at, error, hidden_images, golden_features, quality, image_meta, pinned_main_url, regenerated_main_image",
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
        golden_features: ((e as { golden_features?: unknown } | undefined)?.golden_features ?? []) as Array<{ key: string; value: string }>,
        quality: ((e as { quality?: unknown } | undefined)?.quality ?? null) as unknown as null | {
          watermark_urls?: string[];
          name_mismatch?: boolean;
          feature_mismatches?: string[];
          notes?: string;
        },
      };
    });
  });

function pickThumbsForList(
  urls: string[],
  meta: ImageMeta,
  hidden: Set<string>,
  pinned: string | null,
  max: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const candidates = urls.filter((u) => !hidden.has(u));
  const area = (u: string) => {
    const m = meta[u];
    return m ? m.w * m.h : 0;
  };
  const big: string[] = [];
  const rest: string[] = [];
  for (const u of candidates) {
    const m = meta[u];
    if (m && Math.min(m.w, m.h) >= 600) big.push(u);
    else rest.push(u);
  }
  big.sort((a, b) => area(b) - area(a));
  rest.sort((a, b) => area(b) - area(a));
  const push = (u: string) => {
    if (!u || seen.has(u) || out.length >= max) return;
    seen.add(u);
    out.push(u);
  };
  if (pinned && candidates.includes(pinned)) push(pinned);
  for (const u of big) push(u);
  for (const u of rest) push(u);
  return out;
}

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
    let sources: Array<{
      url: string;
      title: string | null;
      description: string | null;
      images: string[];
      extra_images: string[];
    }> = [];
    if (picked.length) {
      const { data: srcs, error: srcErr } = await supabase
        .from("product_sources")
        .select("url, title, description, images, extra_images")
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
      // Strict size filtering (pickImages) is reserved for export.
      void meta;
      const allowedMain = new Set(allMain.filter((u) => !hidden.has(u)));
      const allowedExtra = new Set(
        includeExtra ? allExtra.filter((u) => !hidden.has(u)) : [],
      );
      sources = picked.map((u) => {
        const s = byUrl.get(u);
        const main = Array.isArray(s?.images) ? (s!.images as string[]) : [];
        const extra = Array.isArray((s as { extra_images?: unknown } | undefined)?.extra_images)
          ? ((s as { extra_images: string[] }).extra_images)
          : [];
        return {
          url: u,
          title: s?.title ?? null,
          description: s?.description ?? null,
          images: main.filter((img) => allowedMain.has(img)),
          extra_images: includeExtra ? extra.filter((img) => allowedExtra.has(img)) : [],
        };
      });
    }
    const image_scores = ((enrichment as unknown as { image_scores?: Record<string, { is_central: number; is_clean: number; is_banner_or_trash: boolean; scored_at?: string }> } | null)?.image_scores ?? {}) as Record<string, { is_central: number; is_clean: number; is_banner_or_trash: boolean; scored_at?: string }>;
    return {
      product,
      enrichment,
      sources,
      hidden_images: Array.from(hidden),
      include_extra_images: includeExtra,
      image_meta: meta,
      image_scores,
      pinned_main_url: ((enrichment as { pinned_main_url?: string | null } | null)?.pinned_main_url ?? null) as string | null,
    };
  });

export const updateGoldenRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      enrichmentId: z.string().uuid(),
      golden_name: z.string().max(500).nullable(),
      golden_description: z.string().max(20000).nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("enrichments")
      .update({
        golden_name: data.golden_name,
        golden_description: data.golden_description,
      } as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
