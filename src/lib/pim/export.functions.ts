import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
        "source_product_id, status, match_type, matched_term, picked_urls, golden_name, golden_description, golden_features, hidden_images, model, generated_at",
      )
      .eq("project_id", data.projectId)
      .limit(100000);

    const imgMap = new Map<string, string[]>();
    const { data: srcs, error: srcErr } = await supabase
      .from("product_sources")
      .select("url, images, extra_images")
      .eq("project_id", data.projectId)
      .limit(5000);
    if (srcErr) console.error("product_sources fetch failed:", srcErr.message);
    for (const s of srcs ?? []) {
      const main = Array.isArray(s.images) ? (s.images as string[]) : [];
      const extra = includeExtra && Array.isArray((s as { extra_images?: unknown }).extra_images)
        ? ((s as { extra_images: string[] }).extra_images)
        : [];
      imgMap.set(s.url, [...main, ...extra]);
    }

    const map = new Map((ens ?? []).map((e) => [e.source_product_id, e]));
    return (products ?? []).map((p) => {
      const e = map.get(p.id);
      const urls = (e?.picked_urls as string[] | undefined) ?? [];
      const hidden = new Set(((e as { hidden_images?: string[] } | undefined)?.hidden_images ?? []) as string[]);
      const images: string[] = [];
      for (const u of urls) {
        for (const img of imgMap.get(u) ?? []) {
          if (!hidden.has(img) && !images.includes(img)) images.push(img);
        }
      }
      const features = ((e as unknown as { golden_features?: Array<{ key: string; value: string }> } | undefined)?.golden_features ?? []);
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
        golden_name: e?.golden_name ?? "",
        golden_description: e?.golden_description ?? "",
        features_text: features.map((f) => `${f.key}: ${f.value}`).join(" | "),
        features_json: features.length ? JSON.stringify(features) : "",
        model: e?.model ?? "",
        generated_at: e?.generated_at ?? "",
      };
    });
  });
