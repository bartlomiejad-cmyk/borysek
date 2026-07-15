import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "get_job_status",
  title: "Status zadania w tle",
  description:
    "Zwraca aktualny status najnowszego bulk-jobu danego typu w projekcie (lub konkretnego jobId). Użyj do sprawdzenia postępu discovery / audit / eksportu.",
  inputSchema: {
    projectId: z.string().uuid().optional(),
    kind: z
      .enum([
        "FIRECRAWL_DISCOVERY",
        "GENERATE_GOLDEN",
        "PIM_AUDIT",
        "PIM_VISUALIZATIONS",
        "PIM_RESCRAPE",
        "PIM_IMAGE_VERIFY",
      ])
      .optional(),
    jobId: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ projectId, kind, jobId }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("bulk_jobs")
      .select(
        "id, project_id, kind, status, total, processed_count, failed_count, cancel_requested, last_error, started_at, finished_at, created_at, updated_at",
      );
    if (jobId) q = q.eq("id", jobId);
    else {
      if (!projectId || !kind) {
        return errorResult("Podaj jobId, albo projectId + kind.");
      }
      q = q.eq("project_id", projectId).eq("kind", kind).order("created_at", { ascending: false }).limit(1);
    }
    const { data, error } = await q.maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return textResult("Brak zadania.", { job: null });
    return textResult(JSON.stringify(data, null, 2), { job: data });
  },
});