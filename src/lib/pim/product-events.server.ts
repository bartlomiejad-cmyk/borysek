// Per-product activity timeline. Server-only helper — must be imported
// dynamically (or top-level in *.server.ts files) so it never leaks into the
// client bundle. Fire-and-forget: a logging failure MUST NOT break a worker.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductEventKind =
  | "discovery_search"
  | "ai_preselect"
  | "discovery_scrape"
  | "matching_done"
  | "rescrape"
  | "golden_generated"
  | "allegro_generated"
  | "media_generated"
  | "image_verify"
  | "audit_done"
  | "review_change"
  | "manual_edit";

export type ProductEventInput = {
  projectId: string;
  productId: string;
  kind: ProductEventKind;
  message: string;
  meta?: Record<string, unknown> | null;
};

export async function logProductEvent(
  admin: SupabaseClient | { from: (t: string) => unknown },
  input: ProductEventInput,
): Promise<void> {
  try {
    const client = admin as unknown as SupabaseClient;
    await client.from("product_events" as never).insert({
      project_id: input.projectId,
      product_id: input.productId,
      kind: input.kind,
      message: input.message.slice(0, 1000),
      meta: (input.meta ?? null) as never,
    } as never);
  } catch (e) {
    console.warn(
      "[product-events] insert failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Delete events older than 90 days. Called from the bulk-jobs cron tick.
 * Batched with LIMIT so a single call never runs long.
 */
export async function cleanupOldProductEvents(
  admin: SupabaseClient,
  batchLimit = 5000,
): Promise<{ deleted: number }> {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    // Select a batch of stale ids then delete by id — Supabase JS client
    // does not support raw `DELETE ... LIMIT`.
    const { data } = await admin
      .from("product_events" as never)
      .select("id")
      .lt("at", cutoff)
      .limit(batchLimit);
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (!ids.length) return { deleted: 0 };
    await admin.from("product_events" as never).delete().in("id", ids);
    return { deleted: ids.length };
  } catch (e) {
    console.warn(
      "[product-events] cleanup failed:",
      e instanceof Error ? e.message : String(e),
    );
    return { deleted: 0 };
  }
}