import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Single-product audit — the editor "Uruchom ponownie audyt" button. Reuses
 * the same worker runner (`runPimAudit`) so the deterministic checks and LLM
 * cross-check cannot drift from the bulk-job version.
 */
export const runAuditForProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ productId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Authorize: caller must own the project this product belongs to (RLS on
    // source_products enforces it, so a plain select is enough).
    const { data: row, error } = await context.supabase
      .from("source_products")
      .select("id")
      .eq("id", data.productId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Produkt nie istnieje lub brak dostępu");

    const { runPimAudit } = await import("./_workers.server");
    const result = await runPimAudit(data.productId);
    if (result.status === "skipped") {
      throw new Error(result.reason);
    }
    return { ok: true, audit: result.audit };
  });