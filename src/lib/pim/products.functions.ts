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