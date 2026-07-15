import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        productIds: z.array(z.string().uuid()).min(1).max(500),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ deleted: number }> => {
    const { supabase, userId } = context;

    // Confirm the project belongs to the current user before touching rows.
    // RLS on source_products already scopes by project.user_id, but this
    // gives us a clean error message instead of a silent 0-row delete.
    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (projErr) throw new Error(projErr.message);
    if (!proj) throw new Error("Projekt nie istnieje lub brak uprawnień");

    // enrichments has ON DELETE CASCADE on source_product_id, so a single
    // delete on source_products removes downstream rows too.
    const { data: deletedRows, error } = await supabase
      .from("source_products")
      .delete()
      .eq("project_id", data.projectId)
      .in("id", data.productIds)
      .select("id");
    if (error) throw new Error(error.message);

    return { deleted: (deletedRows ?? []).length };
  });

// Per-product internal notes injected into AI prompts (never rendered publicly).
export const updateProductNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        productId: z.string().uuid(),
        notes: z.string().max(2000).nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const value = (data.notes ?? "").trim();
    const { error } = await supabase
      .from("source_products")
      .update({ product_notes: value ? value : null } as never)
      .eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Persist per-project client guidelines inside projects.settings (jsonb merge).
export const updateClientGuidelines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        guidelines: z.string().max(4000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error: readErr } = await supabase
      .from("projects")
      .select("settings")
      .eq("id", data.projectId)
      .single();
    if (readErr) throw new Error(readErr.message);
    const settings = { ...((row?.settings as Record<string, unknown> | null) ?? {}) };
    const value = data.guidelines.trim();
    if (value) settings.client_guidelines = value;
    else delete settings.client_guidelines;
    const { error } = await supabase
      .from("projects")
      .update({ settings: settings as never } as never)
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true, hasGuidelines: Boolean(value) };
  });

// Mass-toggle exclusion for a set of products. Reason is 'manual' when
// excluding via this action so re-runs of discovery do not auto-clear it.
export const setProductsExcluded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        productIds: z.array(z.string().uuid()).min(1).max(2000),
        excluded: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ updated: number }> => {
    const { supabase } = context;
    const patch = data.excluded
      ? {
          excluded: true,
          excluded_reason: "manual",
          excluded_at: new Date().toISOString(),
        }
      : { excluded: false, excluded_reason: null, excluded_at: null };
    const { data: rows, error } = await supabase
      .from("source_products")
      .update(patch as never)
      .eq("project_id", data.projectId)
      .in("id", data.productIds)
      .select("id");
    if (error) throw new Error(error.message);
    return { updated: (rows ?? []).length };
  });