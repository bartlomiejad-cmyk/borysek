import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "run_audit",
  title: "Uruchom audyt AI dla produktu",
  description:
    "Wykonuje deterministyczny audyt + LLM cross-check dla pojedynczego produktu (jak przycisk 'Uruchom ponownie audyt' w edytorze). Zwraca werdykt i listę problemów.",
  inputSchema: {
    productId: z.string().uuid(),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  handler: async ({ productId }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    // Authorize via RLS: read-only select on the product; if the user doesn't own it, this returns null.
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("source_products")
      .select("id")
      .eq("id", productId)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return errorResult("Produkt nie istnieje lub brak dostępu.");

    // The worker uses supabaseAdmin internally, but we've already verified ownership.
    const { runPimAudit } = await import("@/lib/pim/_workers.server");
    const result = await runPimAudit(productId);
    if (result.status === "skipped") {
      return errorResult(result.reason ?? "Audyt pominięty");
    }
    return textResult(
      `Audyt zakończony: ${JSON.stringify(result.audit, null, 2)}`,
      { audit: result.audit as unknown as Record<string, unknown> },
    );
  },
});