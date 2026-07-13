import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sourceProductSchema = z.object({
  ext_id: z.string().nullable(),
  nazwa: z.string().nullable(),
  kod: z.string().nullable(),
  ean: z.string().nullable(),
  has_images: z.boolean().optional(),
  main_image_url: z.string().nullable().optional(),
  gallery_urls: z.array(z.string()).optional(),
  raw: z.record(z.unknown()),
});

const searchRowSchema = z.object({
  term: z.string().min(1),
  organic_urls: z.array(z.string()),
});

const productSourceSchema = z.object({
  url: z.string().trim().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
  images: z.array(z.string()),
  extra_images: z.array(z.string()).default([]),
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
    const payload = data.rows.map((r) => {
      const { has_images: _hi, main_image_url: _mi, gallery_urls: _gu, ...rest } = r;
      return { ...rest, project_id: data.projectId };
    });
    const { error } = await supabase.from("source_products").insert(payload as never);
    if (error) throw new Error(error.message);
    // Create pending enrichments
    const { data: inserted } = await supabase
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean")
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

      // Mark enrichments as "already has media" for CSV rows whose image
      // columns were populated. Sentinel is non-http so it isn't rendered as
      // an image; the filter/fill-dialog only checks truthiness.
      const naturalKey = (r: {
        ext_id: string | null;
        nazwa: string | null;
        kod: string | null;
        ean: string | null;
      }) => r.ext_id || r.ean || r.kod || (r.nazwa ? r.nazwa.toLowerCase() : null);
      const imagesByKey = new Map<string, { main: string | null; gallery: string[] }>();
      for (const r of data.rows) {
        const k = naturalKey(r);
        if (!k) continue;
        const main = r.main_image_url ?? null;
        const gallery = r.gallery_urls ?? [];
        if (!main && gallery.length === 0) continue;
        if (!imagesByKey.has(k)) imagesByKey.set(k, { main, gallery });
      }
      if (imagesByKey.size) {
        for (const p of inserted as Array<{
          id: string;
          ext_id: string | null;
          nazwa: string | null;
          kod: string | null;
          ean: string | null;
        }>) {
          const k = naturalKey(p);
          if (!k) continue;
          const imgs = imagesByKey.get(k);
          if (!imgs) continue;
          const combined: string[] = [];
          const seen = new Set<string>();
          for (const u of [imgs.main, ...imgs.gallery]) {
            if (!u || seen.has(u)) continue;
            seen.add(u);
            combined.push(u);
          }
          const patch: Record<string, unknown> = {
            regenerated_main_image: "__imported__",
            ai_gallery_urls: combined,
          };
          if (imgs.main) patch.pinned_main_url = imgs.main;
          const { error: mErr } = await supabase
            .from("enrichments")
            .update(patch as never)
            .eq("source_product_id", p.id);
          if (mErr) throw new Error(mErr.message);
        }
      }
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
    // Deduplicate by url within the same payload — otherwise the upsert
    // throws "ON CONFLICT DO UPDATE command cannot affect row a second time".
    const seen = new Map<string, typeof data.rows[number]>();
    for (const r of data.rows) seen.set(r.url.trim(), { ...r, url: r.url.trim() });
    const deduped = Array.from(seen.values());
    const batches = chunk(deduped, 200);
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

const remapRowSchema = z.object({
  key: z.string().min(1),
  ext_id: z.string().nullable().optional(),
  nazwa: z.string().nullable().optional(),
  kod: z.string().nullable().optional(),
  ean: z.string().nullable().optional(),
});

type RemapField = "ext_id" | "nazwa" | "kod" | "ean";

const normalizeKey = (field: RemapField, v: string | null | undefined) => {
  if (v === null || v === undefined) return "";
  const t = String(v).trim();
  if (!t) return "";
  return field === "nazwa" ? t.toLowerCase() : t;
};

export const updateSourceProductsFromCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      keyField: z.enum(["ext_id", "nazwa", "kod", "ean"]),
      overwrite: z.boolean(),
      rows: z.array(remapRowSchema).max(20000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: products, error } = await supabase
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean")
      .eq("project_id", data.projectId)
      .limit(50000);
    if (error) throw new Error(error.message);

    const byKey = new Map<string, { id: string; ext_id: string | null; nazwa: string | null; kod: string | null; ean: string | null }>();
    for (const p of products ?? []) {
      const k = normalizeKey(data.keyField, (p as Record<string, string | null>)[data.keyField]);
      if (k && !byKey.has(k)) byKey.set(k, p);
    }

    let matched = 0;
    let unmatched = 0;
    let updated = 0;
    let skipped = 0;

    const fields: RemapField[] = ["ext_id", "nazwa", "kod", "ean"];

    for (const r of data.rows) {
      const k = normalizeKey(data.keyField, r.key);
      if (!k) { unmatched++; continue; }
      const prod = byKey.get(k);
      if (!prod) { unmatched++; continue; }
      matched++;

      const patch: Partial<Record<RemapField, string | null>> = {};
      for (const f of fields) {
        const incoming = r[f];
        if (incoming === undefined) continue;
        const trimmed = incoming === null ? null : String(incoming).trim();
        if (trimmed === null || trimmed === "") continue;
        const current = prod[f];
        if (!data.overwrite && current !== null && current !== undefined && String(current).trim() !== "") continue;
        patch[f] = trimmed;
      }

      if (Object.keys(patch).length === 0) { skipped++; continue; }

      const { error: upErr } = await supabase
        .from("source_products")
        .update(patch as never)
        .eq("id", prod.id);
      if (upErr) throw new Error(upErr.message);
      // Reflect locally so duplicate CSV rows hitting the same product behave
      // consistently with overwrite=false on subsequent iterations.
      Object.assign(prod, patch);
      updated++;
    }

    return { matched, unmatched, updated, skipped, total: data.rows.length };
  });