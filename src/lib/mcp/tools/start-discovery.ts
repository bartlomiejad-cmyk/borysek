import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "start_discovery",
  title: "Uruchom wyszukiwanie źródeł",
  description:
    "Startuje bulk-job FIRECRAWL_DISCOVERY dla projektu. Domyślnie obejmuje wszystkie produkty na etapie IMPORTED (bez źródeł). Możesz podać konkretne productIds, żeby ponowić wyszukiwanie dla wskazanych pozycji.",
  inputSchema: {
    projectId: z.string().uuid(),
    productIds: z
      .array(z.string().uuid())
      .max(20000)
      .optional()
      .describe("Opcjonalna jawna lista produktów do przetworzenia."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ projectId, productIds }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const sb = supabaseForUser(ctx);

    // Guard: no active discovery job for this project.
    const { data: existing } = await sb
      .from("bulk_jobs")
      .select("id")
      .eq("project_id", projectId)
      .eq("kind", "FIRECRAWL_DISCOVERY")
      .in("status", ["PENDING", "PROCESSING"])
      .maybeSingle();
    if (existing) {
      return errorResult("Wyszukiwanie źródeł już działa w tle dla tego projektu.");
    }

    // Pick target products.
    const { data: products, error } = await sb
      .from("source_products")
      .select("id, nazwa, pipeline_status")
      .eq("project_id", projectId);
    if (error) return errorResult(error.message);

    const restrict = productIds ? new Set(productIds) : null;
    const targetIds: string[] = [];
    let skippedAdvanced = 0;
    let skippedNoName = 0;
    for (const p of products ?? []) {
      const row = p as { id: string; nazwa: string | null; pipeline_status: string | null };
      const name = (row.nazwa ?? "").trim();
      if (!name) { skippedNoName++; continue; }
      if (!restrict) {
        const ps = row.pipeline_status ?? "IMPORTED";
        if (ps !== "IMPORTED") { skippedAdvanced++; continue; }
      } else if (!restrict.has(row.id)) {
        continue;
      }
      targetIds.push(row.id);
    }
    if (!targetIds.length) {
      return errorResult(
        `Brak produktów do przetworzenia: ${skippedAdvanced} pominięto (dalszy etap), ${skippedNoName} bez nazwy.`,
      );
    }

    // We need userId — read it from the OAuth-verified context.
    const userId = ctx.getUserId();
    if (!userId) return errorResult("Brak identyfikatora użytkownika w tokenie.");

    const { data: row, error: insErr } = await sb
      .from("bulk_jobs")
      .insert({
        project_id: projectId,
        user_id: userId,
        kind: "FIRECRAWL_DISCOVERY",
        items: targetIds,
        total: targetIds.length,
      })
      .select("id, status, total")
      .single();
    if (insErr) return errorResult(insErr.message);

    try {
      const { kickBulkWorker } = await import("@/lib/pim/worker-kick.server");
      kickBulkWorker();
    } catch {
      // cron catches up
    }

    const result = {
      jobId: (row as { id: string }).id,
      total: targetIds.length,
      skippedAdvanced,
      skippedNoName,
    };
    return textResult(
      `Uruchomiono wyszukiwanie źródeł: job ${result.jobId}, ${result.total} produktów w kolejce (pominięto ${skippedAdvanced} zaawansowanych, ${skippedNoName} bez nazwy). Sprawdzaj postęp narzędziem get_job_status.`,
      result,
    );
  },
});