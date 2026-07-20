import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PreviewProduct = {
  id: string;
  nazwa: string;
  ean: string | null;
  kod: string | null;
  ext_id: string | null;
};

export type PreviewSource = {
  url: string;
  title: string | null;
  images: string[];
  extra_images: string[];
};

export type PreviewEnrichment = {
  golden_name: string | null;
  golden_description: string | null;
  golden_slug: string | null;
  golden_meta_description: string | null;
  golden_seo_keywords: string[] | null;
  golden_features: Array<{ key: string; value: string }> | null;
  ai_gallery_urls: string[] | null;
  regenerated_main_image: string | null;
  pinned_main_url: string | null;
};

export type ProductPreviewData = {
  product: PreviewProduct;
  enrichment: PreviewEnrichment | null;
  sources: PreviewSource[];
  include_extra_images: boolean;
};

/**
 * Public product preview — no auth required. This endpoint exists so that
 * clients without a Lovable account can view a generated product card via
 * a shared URL. Uses the admin client to bypass RLS, but returns ONLY
 * preview-safe fields (no user IDs, no internal scoring, no source URLs
 * beyond what a shopper would see).
 */
export const getProductPreview = createServerFn({ method: "GET" })
  .inputValidator((i) =>
    z.object({ projectId: z.string().uuid(), productId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }): Promise<ProductPreviewData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id, include_extra_images")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project) throw new Error("Projekt nie istnieje.");

    const { data: product } = await supabaseAdmin
      .from("source_products")
      .select("id, nazwa, ean, kod, ext_id, project_id")
      .eq("id", data.productId)
      .maybeSingle();
    if (!product || product.project_id !== data.projectId) {
      throw new Error("Produkt nie istnieje w tym projekcie.");
    }

    const { data: enrichment } = await supabaseAdmin
      .from("enrichments")
      .select(
        "golden_name, golden_description, golden_slug, golden_meta_description, golden_seo_keywords, golden_features, ai_gallery_urls, regenerated_main_image, pinned_main_url, picked_urls, hidden_images, image_scores, image_meta",
      )
      .eq("source_product_id", data.productId)
      .maybeSingle();

    const picked = ((enrichment?.picked_urls as string[] | null) ?? []) as string[];
    const hidden = new Set(
      ((enrichment as { hidden_images?: string[] } | null)?.hidden_images ?? []) as string[],
    );
    const scores = ((enrichment as unknown as {
      image_scores?: Record<string, { is_banner_or_trash?: boolean; identity?: string; manual_keep?: boolean; dead?: boolean }>;
    } | null)?.image_scores ?? {}) as Record<
      string,
      { is_banner_or_trash?: boolean; identity?: string; manual_keep?: boolean; dead?: boolean }
    >;
    const importedRaw = (enrichment as unknown as {
      image_meta?: { imported_images?: unknown };
    } | null)?.image_meta?.imported_images;
    const imported = Array.isArray(importedRaw)
      ? (importedRaw as unknown[]).filter((u): u is string => typeof u === "string")
      : [];
    const trash = new Set<string>(
      Object.entries(scores)
        .filter(([, s]) => {
          if (!s) return false;
          if (s.manual_keep === true) return false;
          if (s.is_banner_or_trash === true) return true;
          if (s.identity === "different") return true;
          if (s.identity === "unsure") return true;
          if (s.dead === true) return true;
          return false;
        })
        .map(([u]) => u),
    );
    for (const u of imported) trash.delete(u);

    let sources: PreviewSource[] = [];
    if (picked.length) {
      const { data: srcs } = await supabaseAdmin
        .from("product_sources")
        .select("url, title, images, extra_images")
        .eq("project_id", data.projectId)
        .in("url", picked);
      const byUrl = new Map(srcs?.map((s) => [s.url, s]) ?? []);
      sources = picked.map((u) => {
        const s = byUrl.get(u);
        const main = Array.isArray(s?.images) ? (s!.images as string[]) : [];
        const extra = Array.isArray((s as { extra_images?: unknown } | undefined)?.extra_images)
          ? ((s as { extra_images: string[] }).extra_images)
          : [];
        return {
          url: u,
          title: s?.title ?? null,
          images: main.filter((img) => !hidden.has(img) && !trash.has(img)),
          extra_images: project.include_extra_images
            ? extra.filter((img) => !hidden.has(img) && !trash.has(img))
            : [],
        };
      });
    }

    return {
      product: {
        id: product.id,
        nazwa: product.nazwa,
        ean: product.ean,
        kod: product.kod,
        ext_id: product.ext_id,
      },
      enrichment: enrichment
        ? {
            golden_name: enrichment.golden_name ?? null,
            golden_description: enrichment.golden_description ?? null,
            golden_slug: enrichment.golden_slug ?? null,
            golden_meta_description: enrichment.golden_meta_description ?? null,
            golden_seo_keywords: (enrichment.golden_seo_keywords as string[] | null) ?? null,
            golden_features: (enrichment.golden_features as Array<{ key: string; value: string }> | null) ?? null,
            ai_gallery_urls: (enrichment.ai_gallery_urls as string[] | null) ?? null,
            regenerated_main_image: enrichment.regenerated_main_image ?? null,
            pinned_main_url: (enrichment as { pinned_main_url?: string | null }).pinned_main_url ?? null,
          }
        : null,
      sources,
      include_extra_images: !!project.include_extra_images,
    };
  });