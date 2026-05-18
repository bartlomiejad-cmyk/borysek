import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      .select("source_product_id, status, match_type, picked_urls, golden_name, generated_at, error")
      .in("source_product_id", ids);
    type EnrichRow = NonNullable<typeof ens>[number];
    const enMap = new Map<string, EnrichRow>();
    for (const e of ens ?? []) enMap.set(e.source_product_id, e);

    const allUrls = Array.from(
      new Set((ens ?? []).flatMap((e) => (e.picked_urls as string[] | null) ?? [])),
    );
    const thumbMap = new Map<string, string | null>();
    if (allUrls.length) {
      const { data: srcs } = await supabase
        .from("product_sources")
        .select("url, images")
        .eq("project_id", data.projectId)
        .in("url", allUrls);
      for (const s of srcs ?? []) {
        const arr = Array.isArray(s.images) ? (s.images as string[]) : [];
        thumbMap.set(s.url, arr[0] ?? null);
      }
    }

    return (products ?? []).map((p) => {
      const e = enMap.get(p.id);
      const picked = (e?.picked_urls as string[] | undefined) ?? [];
      const thumb = picked.map((u) => thumbMap.get(u)).find(Boolean) ?? null;
      return {
        ...p,
        status: e?.status ?? "PENDING",
        match_type: e?.match_type ?? "NO_MATCH",
        golden_name: e?.golden_name ?? null,
        generated_at: e?.generated_at ?? null,
        error: e?.error ?? null,
        thumbnail: thumb,
        picked_urls: picked,
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
    const picked = ((enrichment?.picked_urls as string[] | null) ?? []).slice(0, 3);
    let sources: Array<{
      url: string;
      title: string | null;
      description: string | null;
      images: string[];
    }> = [];
    if (picked.length) {
      const { data: srcs } = await supabase
        .from("product_sources")
        .select("url, title, description, images")
        .eq("project_id", data.projectId)
        .in("url", picked);
      const byUrl = new Map(srcs?.map((s) => [s.url, s]) ?? []);
      sources = picked.map((u) => {
        const s = byUrl.get(u);
        return {
          url: u,
          title: s?.title ?? null,
          description: s?.description ?? null,
          images: Array.isArray(s?.images) ? (s!.images as string[]) : [],
        };
      });
    }
    return { product, enrichment, sources };
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