import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sourceProductSchema = z.object({
  ext_id: z.string().nullable(),
  nazwa: z.string().nullable(),
  kod: z.string().nullable(),
  ean: z.string().nullable(),
  raw: z.record(z.unknown()),
});

const searchRowSchema = z.object({
  term: z.string().min(1),
  organic_urls: z.array(z.string()),
});

const productSourceSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
  images: z.array(z.string()),
  raw: z.record(z.unknown()),
});

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const ingestSourceProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      rows: z.array(sourceProductSchema).max(2000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const payload = data.rows.map((r) => ({ ...r, project_id: data.projectId }));
    const { error } = await supabase.from("source_products").insert(payload as never);
    if (error) throw new Error(error.message);
    // Create pending enrichments
    const { data: inserted } = await supabase
      .from("source_products")
      .select("id")
      .eq("project_id", data.projectId);
    if (inserted) {
      const enr = inserted.map((row) => ({
        source_product_id: row.id,
        project_id: data.projectId,
        status: "PENDING" as const,
        match_type: "NO_MATCH" as const,
      }));
      // upsert by unique source_product_id
      const { error: enErr } = await supabase
        .from("enrichments")
        .upsert(enr as never, { onConflict: "source_product_id", ignoreDuplicates: true });
      if (enErr) throw new Error(enErr.message);
    }
    return { inserted: payload.length };
  });

export const ingestSearchResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      rows: z.array(searchRowSchema).max(5000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const batches = chunk(data.rows, 500);
    for (const b of batches) {
      const payload = b.map((r) => ({
        project_id: data.projectId,
        term: r.term,
        organic_urls: r.organic_urls,
      }));
      const { error } = await supabase.from("search_results").insert(payload as never);
      if (error) throw new Error(error.message);
    }
    return { inserted: data.rows.length };
  });

export const ingestProductSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      rows: z.array(productSourceSchema).max(2000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const batches = chunk(data.rows, 200);
    for (const b of batches) {
      const payload = b.map((r) => ({ ...r, project_id: data.projectId }));
      const { error } = await supabase
        .from("product_sources")
        .upsert(payload as never, { onConflict: "project_id,url" });
      if (error) throw new Error(error.message);
    }
    return { inserted: data.rows.length };
  });

export const clearProjectData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      scope: z.enum(["source_products", "search_results", "product_sources", "all"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const tables =
      data.scope === "all"
        ? ["enrichments", "source_products", "search_results", "product_sources"]
        : data.scope === "source_products"
          ? ["enrichments", "source_products"]
          : [data.scope];
    for (const t of tables) {
      const { error } = await (supabase.from(t as never) as any).delete().eq("project_id", data.projectId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });