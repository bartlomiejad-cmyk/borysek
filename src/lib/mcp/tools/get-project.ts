import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_project",
  title: "Szczegóły projektu",
  description:
    "Zwraca metadane projektu oraz podsumowanie licznikami produktów wg pipeline_status (IMPORTED, MATCHED, GOLDEN_READY, itd.).",
  inputSchema: {
    projectId: z.string().uuid().describe("Identyfikator projektu."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ projectId }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const sb = supabaseForUser(ctx);
    const { data: project, error } = await sb
      .from("projects")
      .select("id, name, strategy, custom_prompt, blacklist, include_extra_images, created_at, updated_at")
      .eq("id", projectId)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!project) return errorResult("Projekt nie istnieje lub brak dostępu.");

    const { data: rows } = await sb
      .from("source_products")
      .select("pipeline_status, review_status")
      .eq("project_id", projectId);
    const byPipeline: Record<string, number> = {};
    const byReview: Record<string, number> = {};
    for (const r of (rows ?? []) as Array<{ pipeline_status?: string | null; review_status?: string | null }>) {
      const ps = r.pipeline_status ?? "IMPORTED";
      byPipeline[ps] = (byPipeline[ps] ?? 0) + 1;
      const rs = r.review_status ?? "PENDING";
      byReview[rs] = (byReview[rs] ?? 0) + 1;
    }
    const summary = {
      project,
      total_products: rows?.length ?? 0,
      by_pipeline_status: byPipeline,
      by_review_status: byReview,
    };
    return textResult(JSON.stringify(summary, null, 2), summary);
  },
});