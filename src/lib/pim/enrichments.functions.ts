import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const loadEnrichment = async (
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  enrichmentId: string,
) => {
  const { data, error } = await supabase
    .from("enrichments")
    .select("id, hidden_images")
    .eq("id", enrichmentId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Enrichment not found");
  return data as { id: string; hidden_images: string[] | null };
};

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
    return { ok: true, ai_gallery_urls: next };
  });
