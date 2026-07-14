import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductEventRow = {
  id: string;
  at: string;
  kind: string;
  message: string;
  meta: null;
};

/**
 * Read a page of activity events for a single product. RLS on
 * `product_events` scopes rows to the project owner, so we simply query
 * through the authenticated client.
 */
export const getProductEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        productId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(100),
        beforeAt: z.string().datetime().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("product_events")
      .select("id, at, kind, message, meta")
      .eq("product_id", data.productId)
      .order("at", { ascending: false })
      .limit(data.limit);
    if (data.beforeAt) q = q.lt("at", data.beforeAt);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as ProductEventRow[];
  });