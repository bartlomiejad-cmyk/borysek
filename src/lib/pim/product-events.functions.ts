import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// UI-side row type; meta is treated as opaque JSON. We cast on read to keep
// createServerFn's serialization checker happy (it rejects `unknown`).
export type ProductEventMeta = {
  variants?: Array<{ variant?: string; query?: string; kind?: string; results_count?: number }>;
  scraped_urls?: string[];
  rejected?: Array<{ url?: string; reason?: string }>;
  accepted?: string[];
  rejected_count?: number;
  ai_validation_used?: boolean;
  clusters_found?: number;
  ean_confirmed_count?: number;
  added_urls?: string[];
  model?: string;
  data_sufficiency?: string | null;
  qc?: { ok?: boolean; issues?: string[] };
  style_used?: string;
  scene?: string;
  slot?: number;
  accepted_count?: number;
  rejected_images_count?: number;
  uncertain_count?: number;
  verdict?: string;
  issues?: string[];
  action?: string;
  actor_id?: string | null;
  round?: number;
  count?: number;
  [key: string]: unknown;
};

export type ProductEventRow = {
  id: string;
  at: string;
  kind: string;
  message: string;
  meta: ProductEventMeta | null;
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