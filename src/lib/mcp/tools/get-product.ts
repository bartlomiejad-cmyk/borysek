import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_product",
  title: "Szczegóły produktu",
  description:
    "Zwraca produkt źródłowy, jego źródła (product_sources) i aktualny enrichment (golden name/description/features, picked_urls, status audytu).",
  inputSchema: {
    productId: z.string().uuid(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ productId }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const sb = supabaseForUser(ctx);
    const { data: product, error } = await sb
      .from("source_products")
      .select(
        "id, project_id, ext_id, nazwa, kod, ean, category, pipeline_status, review_status, matching_mode, product_notes, created_at",
      )
      .eq("id", productId)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!product) return errorResult("Produkt nie istnieje lub brak dostępu.");

    const [{ data: sources }, { data: enrichment }] = await Promise.all([
      sb
        .from("product_sources")
        .select("url, title, score, provider, images, extra_images, created_at")
        .eq("source_product_id", productId)
        .order("score", { ascending: false })
        .limit(50),
      sb
        .from("enrichments")
        .select(
          "id, status, match_type, matched_term, picked_urls, golden_name, golden_description, golden_features, golden_slug, golden_meta_description, golden_seo_keywords, audit, data_sufficiency, generated_at, updated_at",
        )
        .eq("source_product_id", productId)
        .maybeSingle(),
    ]);

    const payload = { product, sources: sources ?? [], enrichment: enrichment ?? null };
    return textResult(JSON.stringify(payload, null, 2), payload);
  },
});