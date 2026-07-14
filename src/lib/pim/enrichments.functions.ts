import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { setManualLockOnProduct } from "./pipeline-status";

async function logManualEdit(
  supabase: { from: (t: string) => any },
  productId: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  try {
    const { data: p } = await supabase
      .from("source_products")
      .select("project_id")
      .eq("id", productId)
      .maybeSingle();
    const projectId = (p as { project_id?: string } | null)?.project_id;
    if (!projectId) return;
    const { logProductEvent } = await import("./product-events.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await logProductEvent(supabaseAdmin, {
      projectId,
      productId,
      kind: "manual_edit",
      message,
      meta: meta ?? null,
    });
  } catch { /* best-effort */ }
}

const loadEnrichment = async (
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  enrichmentId: string,
) => {
  const { data, error } = await supabase
    .from("enrichments")
    .select("id, hidden_images, source_product_id")
    .eq("id", enrichmentId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Enrichment not found");
  return data as { id: string; hidden_images: string[] | null; source_product_id: string };
};

async function lockByEnrichmentId(
  supabase: { from: (t: string) => any },
  enrichmentId: string,
): Promise<void> {
  const { data } = await supabase
    .from("enrichments")
    .select("source_product_id")
    .eq("id", enrichmentId)
    .maybeSingle();
  const pid = (data as { source_product_id?: string } | null)?.source_product_id;
  if (pid) await setManualLockOnProduct(supabase as never, pid, true);
}

export const hideImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      enrichmentId: z.string().uuid(),
      url: z.string().url(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const cur = await loadEnrichment(supabase as never, data.enrichmentId);
    const set = new Set(cur.hidden_images ?? []);
    set.add(data.url);
    const { error } = await supabase
      .from("enrichments")
      .update({ hidden_images: Array.from(set) } as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    if (cur.source_product_id) {
      await setManualLockOnProduct(supabase as never, cur.source_product_id, true);
    }
    return { ok: true, hidden: Array.from(set) };
  });

export const unhideImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      enrichmentId: z.string().uuid(),
      url: z.string().url(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const cur = await loadEnrichment(supabase as never, data.enrichmentId);
    const next = (cur.hidden_images ?? []).filter((u) => u !== data.url);
    const { error } = await supabase
      .from("enrichments")
      .update({ hidden_images: next } as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    if (cur.source_product_id) {
      await setManualLockOnProduct(supabase as never, cur.source_product_id, true);
    }
    return { ok: true, hidden: next };
  });

export const updateFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      enrichmentId: z.string().uuid(),
      features: z
        .array(z.object({ key: z.string().min(1).max(200), value: z.string().min(1).max(2000) }))
        .max(200),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("enrichments")
      .update({ golden_features: data.features } as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    await lockByEnrichmentId(supabase as never, data.enrichmentId);
    return { ok: true };
  });

export const hideImageByProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      productId: z.string().uuid(),
      url: z.string().url(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: en } = await supabase
      .from("enrichments")
      .select("id, hidden_images")
      .eq("source_product_id", data.productId)
      .maybeSingle();
    if (!en) throw new Error("Enrichment not found");
    const set = new Set(((en as { hidden_images?: string[] }).hidden_images ?? []));
    set.add(data.url);
    const { error } = await supabase
      .from("enrichments")
      .update({ hidden_images: Array.from(set) } as never)
      .eq("id", (en as { id: string }).id);
    if (error) throw new Error(error.message);
    await setManualLockOnProduct(supabase as never, data.productId, true);
    return { ok: true };
  });

export const setPinnedMainImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      enrichmentId: z.string().uuid(),
      url: z.string().url().nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("enrichments")
      .update({ pinned_main_url: data.url } as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    await lockByEnrichmentId(supabase as never, data.enrichmentId);
    return { ok: true };
  });

export const removeGalleryUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      enrichmentId: z.string().uuid(),
      url: z.string().url(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: cur, error: readErr } = await supabase
      .from("enrichments")
      .select("id, ai_gallery_urls")
      .eq("id", data.enrichmentId)
      .single();
    if (readErr || !cur) throw new Error(readErr?.message ?? "Enrichment not found");
    const existing = ((cur as unknown as { ai_gallery_urls?: string[] | null }).ai_gallery_urls ?? []) as string[];
    const next = existing.filter((u) => u !== data.url);
    const { error } = await supabase
      .from("enrichments")
      .update({ ai_gallery_urls: next as never } as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    await lockByEnrichmentId(supabase as never, data.enrichmentId);
    return { ok: true, ai_gallery_urls: next };
  });

/**
 * Toggle the manual edit lock on a product. When locked, bulk workers
 * (golden record, Allegro description, matching rescore, media/visualization
 * regeneration) skip or refuse to overwrite the product's data. Firecrawl
 * discovery still runs — it only adds new candidate sources.
 */
export const setManualLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      productId: z.string().uuid(),
      locked: z.boolean(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("source_products")
      .update({ manual_lock: data.locked } as never)
      .eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true, locked: data.locked };
  });
