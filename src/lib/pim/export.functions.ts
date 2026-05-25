import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pickImages, pickThumbsForList, type ImageMeta, type ImageScores } from "./images";

export const exportProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: project } = await supabase
      .from("projects")
      .select("include_extra_images")
      .eq("id", data.projectId)
      .single();
    const includeExtra = (project as { include_extra_images?: boolean } | null)?.include_extra_images ?? false;

    const { data: products, error } = await supabase
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: ens } = await supabase
      .from("enrichments")
      .select(
        "source_product_id, status, match_type, matched_term, picked_urls, golden_name, golden_description, golden_features, hidden_images, image_meta, image_scores, regenerated_main_image, ai_gallery_urls, pinned_main_url, model, generated_at",
      )
      .eq("project_id", data.projectId)
      .limit(100000);

    const imgMap = new Map<string, string[]>();
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
      const extra = includeExtra && Array.isArray((s as { extra_images?: unknown }).extra_images)
        ? ((s as { extra_images: string[] }).extra_images)
        : [];
      imgMap.set(s.url, [...main, ...extra]);
    }

    const map = new Map((ens ?? []).map((e) => [e.source_product_id, e]));

    // Pass 1: zbierz unikalny zbiór kluczy cech w całym projekcie (stabilna kolejność kolumn).
    const normalizeKey = (k: string) =>
      k.trim().replace(/[\s;]+/g, "_").replace(/_{2,}/g, "_");
    const allFeatureKeys = new Set<string>();
    for (const e of ens ?? []) {
      const feats = ((e as unknown as { golden_features?: Array<{ key: string; value: string }> }).golden_features) ?? [];
      for (const f of feats) {
        const k = normalizeKey(f.key ?? "");
        if (k) allFeatureKeys.add(k);
      }
    }
    const sortedFeatureKeys = [...allFeatureKeys].sort((a, b) => a.localeCompare(b, "pl"));

    // Max długość galerii AI w projekcie — wyznacza ile kolumn ai_gallery_*.
    let maxGallery = 0;
    for (const e of ens ?? []) {
      const g = ((e as unknown as { ai_gallery_urls?: string[] }).ai_gallery_urls) ?? [];
      if (Array.isArray(g) && g.length > maxGallery) maxGallery = g.length;
    }

    return (products ?? []).map((p) => {
      const e = map.get(p.id);
      const urls = (e?.picked_urls as string[] | undefined) ?? [];
      const hidden = new Set(((e as { hidden_images?: string[] } | undefined)?.hidden_images ?? []) as string[]);
      const meta = ((e as unknown as { image_meta?: ImageMeta } | undefined)?.image_meta ?? {}) as ImageMeta;
      const scores = ((e as unknown as { image_scores?: ImageScores } | undefined)?.image_scores ?? {}) as ImageScores;
      const all: string[] = [];
      for (const u of urls) {
        for (const img of imgMap.get(u) ?? []) {
          if (!all.includes(img)) all.push(img);
        }
      }
      // Scrapowane zdjęcia ze źródeł — bez wymuszania regen. URL AI ma własną kolumnę.
      const images = pickImages(all, meta, hidden, scores);
      // Te same URL-e i kolejność co widok listy produktów (pinned > >=600 > reszta).
      const pinned = ((e as { pinned_main_url?: string | null } | undefined)?.pinned_main_url ?? null) as string | null;
      const listImages = pickThumbsForList(all, meta, hidden, pinned, 12);
      const regen = ((e as { regenerated_main_image?: string | null } | undefined)?.regenerated_main_image) ?? "";
      const gallery = (((e as unknown as { ai_gallery_urls?: string[] } | undefined)?.ai_gallery_urls) ?? []) as string[];
      const features = ((e as unknown as { golden_features?: Array<{ key: string; value: string }> } | undefined)?.golden_features ?? []);
      const featureCols: Record<string, string> = {};
      for (const k of sortedFeatureKeys) featureCols[`cecha_${k}`] = "";
      for (const f of features) {
        const k = normalizeKey(f.key ?? "");
        if (k) featureCols[`cecha_${k}`] = f.value ?? "";
      }
      const galleryCols: Record<string, string> = {};
      for (let i = 0; i < maxGallery; i++) galleryCols[`ai_gallery_${i + 1}`] = gallery[i] ?? "";
      return {
        id: p.ext_id ?? "",
        nazwa: p.nazwa ?? "",
        kod: p.kod ?? "",
        ean: p.ean ?? "",
        status: e?.status ?? "PENDING",
        match_type: e?.match_type ?? "NO_MATCH",
        matched_term: e?.matched_term ?? "",
        url_1: urls[0] ?? "",
        url_2: urls[1] ?? "",
        url_3: urls[2] ?? "",
        image_1: images[0] ?? "",
        image_2: images[1] ?? "",
        image_3: images[2] ?? "",
        images_all: images.join(" | "),
        Final_main_image: listImages[0] ?? "",
        Final_images: listImages.join(","),
        ai_image_main: regen,
        ai_gallery_all: gallery.join(" | "),
        ...galleryCols,
        golden_name: e?.golden_name ?? "",
        golden_description: e?.golden_description ?? "",
        features_text: features.map((f) => `${f.key}: ${f.value}`).join(" | "),
        ...featureCols,
        model: e?.model ?? "",
        generated_at: e?.generated_at ?? "",
      };
    });
  });
