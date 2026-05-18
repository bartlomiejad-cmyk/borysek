import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, strategy, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ name: z.string().min(1).max(120) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .insert({ name: data.name, user_id: userId } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row as { id: string };
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !project) throw new Error(error?.message ?? "Not found");

    const [sp, sr, ps, en] = await Promise.all([
      supabase.from("source_products").select("id", { count: "exact", head: true }).eq("project_id", data.id),
      supabase.from("search_results").select("id", { count: "exact", head: true }).eq("project_id", data.id),
      supabase.from("product_sources").select("id", { count: "exact", head: true }).eq("project_id", data.id),
      supabase.from("enrichments").select("status", { count: "exact" }).eq("project_id", data.id),
    ]);
    const counts = {
      source_products: sp.count ?? 0,
      search_results: sr.count ?? 0,
      product_sources: ps.count ?? 0,
      enrichments_total: en.count ?? 0,
      enrichments_done: (en.data ?? []).filter((r: { status: string }) => r.status === "DONE").length,
    };
    return { project, counts };
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(120).optional(),
      custom_prompt: z.string().max(8000).optional(),
      blacklist: z.array(z.string().min(1).max(120)).max(200).optional(),
      strategy: z.enum(["EAN", "NAZWA", "HYBRID"]).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...patch } = data;
    const { error } = await supabase.from("projects").update(patch as never).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });