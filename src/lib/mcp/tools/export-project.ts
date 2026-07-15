import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "export_project",
  title: "Eksport danych produktowych projektu",
  description:
    "Zwraca kompaktowy JSON produktów projektu z golden name/description/features/slug/meta oraz picked_urls. Domyślnie tylko produkty APPROVED. Bez galerii i obrazków – do peł­nego eksportu z obrazkami użyj UI (Dostawa).",
  inputSchema: {
    projectId: z.string().uuid(),
    approvedOnly: z.boolean().default(true),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ projectId, approvedOnly }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const sb = supabaseForUser(ctx);
    let prodQ = sb
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean, category, review_status, pipeline_status")
      .eq("project_id", projectId);
    if (approvedOnly) prodQ = prodQ.eq("review_status", "APPROVED");
    const { data: products, error } = await prodQ.order("created_at", { ascending: true });
    if (error) return errorResult(error.message);
    const ids = (products ?? []).map((p) => (p as { id: string }).id);
    if (!ids.length) return textResult("Brak produktów.", { products: [] });

    const { data: ens } = await sb
      .from("enrichments")
      .select(
        "source_product_id, golden_name, golden_slug, golden_meta_description, golden_description, golden_features, golden_seo_keywords, picked_urls, data_sufficiency",
      )
      .in("source_product_id", ids);
    const byId = new Map<string, unknown>();
    for (const e of ens ?? []) byId.set((e as { source_product_id: string }).source_product_id, e);

    const merged = (products ?? []).map((p) => {
      const row = p as Record<string, unknown> & { id: string };
      return { ...row, enrichment: byId.get(row.id) ?? null };
    });
    return textResult(JSON.stringify(merged, null, 2), { products: merged });
  },
});