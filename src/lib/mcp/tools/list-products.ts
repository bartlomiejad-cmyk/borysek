import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "list_products",
  title: "Lista produktów w projekcie",
  description:
    "Zwraca produkty źródłowe (source_products) dla projektu. Możesz filtrować po pipeline_status i review_status oraz limitować liczbę wyników. Do wyszukania konkretnego produktu użyj `query` (dopasowanie w nazwie/kodzie/EAN).",
  inputSchema: {
    projectId: z.string().uuid(),
    pipelineStatus: z
      .enum([
        "IMPORTED",
        "MATCHED",
        "GOLDEN_READY",
        "MEDIA_READY",
        "AUDITED",
        "APPROVED",
      ])
      .optional()
      .describe("Filtr etapu pipeline'u."),
    reviewStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
    query: z.string().max(200).optional().describe("Dopasowanie tekstowe (nazwa/kod/EAN)."),
    limit: z.number().int().min(1).max(500).default(100),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ projectId, pipelineStatus, reviewStatus, query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean, category, pipeline_status, review_status, matching_mode, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (pipelineStatus) q = q.eq("pipeline_status", pipelineStatus);
    if (reviewStatus) q = q.eq("review_status", reviewStatus);
    if (query && query.trim()) {
      const like = `%${query.trim().replace(/[%_]/g, "")}%`;
      q = q.or(`nazwa.ilike.${like},kod.ilike.${like},ean.ilike.${like}`);
    }
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return textResult(JSON.stringify(data ?? [], null, 2), { products: data ?? [], count: data?.length ?? 0 });
  },
});