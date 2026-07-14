import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Manual product approval flow. Approval never sets manual_lock and is
 * never granted automatically — only these functions can flip a product
 * to APPROVED / back to NONE. Regeneration and client "needs fix" feedback
 * demote APPROVED products (see runGenerateGoldenRecord,
 * runPimAllegroDescription, submitShareFeedback).
 */

export const approveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ productId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("source_products")
      .update({
        review_status: "APPROVED",
        approved_at: new Date().toISOString(),
        approved_by: userId,
      } as never)
      .eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unapproveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ productId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("source_products")
      .update({
        review_status: "NONE",
        approved_at: null,
        approved_by: null,
      } as never)
      .eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Bulk-approve every product in a project whose audit verdict is `pass`
 * and that is not already APPROVED. Optionally scoped to `productIds`.
 */
export const bulkApprovePass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        productIds: z.array(z.string().uuid()).max(5000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load candidate products (limit by ids if provided) with their review_status.
    let q = supabase
      .from("source_products")
      .select("id, review_status")
      .eq("project_id", data.projectId);
    if (data.productIds && data.productIds.length > 0) {
      q = q.in("id", data.productIds);
    }
    const { data: products, error: pErr } = await q.limit(10000);
    if (pErr) throw new Error(pErr.message);

    const candidateIds = (products ?? [])
      .filter(
        (p) =>
          ((p as { review_status?: string | null }).review_status ?? "NONE") !==
          "APPROVED",
      )
      .map((p) => (p as { id: string }).id);
    if (candidateIds.length === 0) return { approved: 0 };

    // Fetch the audit verdicts for candidate products; keep only 'pass'.
    const { data: ens, error: eErr } = await supabase
      .from("enrichments")
      .select("source_product_id, audit")
      .in("source_product_id", candidateIds);
    if (eErr) throw new Error(eErr.message);

    const passIds: string[] = [];
    for (const e of (ens ?? []) as Array<{
      source_product_id: string;
      audit?: { verdict?: string } | null;
    }>) {
      if (e.audit && e.audit.verdict === "pass") passIds.push(e.source_product_id);
    }
    if (passIds.length === 0) return { approved: 0 };

    const nowIso = new Date().toISOString();
    // Chunk to keep the update .in(...) list within safe URL limits.
    let approved = 0;
    for (let i = 0; i < passIds.length; i += 200) {
      const chunk = passIds.slice(i, i + 200);
      const { error, count } = await supabase
        .from("source_products")
        .update(
          {
            review_status: "APPROVED",
            approved_at: nowIso,
            approved_by: userId,
          } as never,
          { count: "exact" },
        )
        .in("id", chunk);
      if (error) throw new Error(error.message);
      approved += count ?? chunk.length;
    }
    return { approved };
  });