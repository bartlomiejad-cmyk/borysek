import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Retroactive hierarchy classification. Walks the project's existing
 * `source_products.raw` payloads (captured at import time) and reclassifies
 * rows the import-time heuristic would have marked as variants — but which
 * ended up as row_kind='main' because the original import ran before the
 * hierarchy detection existed, or because hierarchy columns were only
 * populated by a later supplement CSV.
 *
 * One-direction only: main → variant. Never touches:
 *   - rows with manual_lock=true (user explicitly restored / pinned them);
 *   - rows that are already row_kind='variant';
 *   - projects with no hierarchy signal in raw (returns ok=false).
 *
 * Mirrors `classifyType` + child→parent map from parsers.ts. Reuses the
 * import-time semantics rather than defining new heuristics.
 */
async function reclassifyVariantsCore(
  supabase: { from: (t: string) => unknown } & Record<string, unknown>,
  projectId: string,
): Promise<{ ok: boolean; reason?: string; mains: number; variants: number; reclassified: number; skippedLocked: number }> {
  type Row = {
    id: string;
    kod: string | null;
    ean: string | null;
    nazwa: string | null;
    raw: Record<string, unknown> | null;
    row_kind: string | null;
    manual_lock: boolean | null;
    excluded: boolean | null;
    excluded_reason: string | null;
    parent_sku: string | null;
  };
  const { data: products, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: string) => { limit: (n: number) => Promise<{ data: Row[] | null; error: { message: string } | null }> };
      };
    };
  })
    .from("source_products")
    .select("id, kod, ean, nazwa, raw, row_kind, manual_lock, excluded, excluded_reason, parent_sku")
    .eq("project_id", projectId)
    .limit(20000);
  if (error) throw new Error(error.message);
  const rows: Row[] = products ?? [];

  const HIER_KEYS = new Set([
    "_type", "typ", "product_type", "type",
    "_children", "children", "variant_skus",
    "parent_sku", "_parent_sku", "_parent", "parent",
  ]);
  let hasHier = false;
  for (const r of rows) {
    if (!r.raw) continue;
    for (const k of Object.keys(r.raw)) {
      if (HIER_KEYS.has(k.toLowerCase())) { hasHier = true; break; }
    }
    if (hasHier) break;
  }
  if (!hasHier) {
    return { ok: false, reason: "no_hierarchy_columns", mains: 0, variants: 0, reclassified: 0, skippedLocked: 0 };
  }

  const pickCI = (r: Record<string, unknown>, keys: string[]): string | null => {
    const lc = keys.map((k) => k.toLowerCase());
    for (const key of Object.keys(r)) {
      if (lc.includes(key.toLowerCase())) {
        const v = r[key];
        if (v === null || v === undefined || v === "") continue;
        return String(v).trim();
      }
    }
    return null;
  };
  const classifyType = (v: string | null): "main" | "variant" | null => {
    if (!v) return null;
    const t = v.trim().toLowerCase();
    if (!t) return null;
    if (t.includes("variation") || t.includes("wariant")) return "variant";
    if (t === "variable" || t.includes("variable-product") || t === "variable_product") return "main";
    return null;
  };

  // Build child→parent map from _children columns on parent rows.
  const childToParent = new Map<string, string>();
  for (const r of rows) {
    const raw = r.raw ?? {};
    const parentSku = r.kod;
    const kidsRaw = pickCI(raw, ["_children", "children", "variant_skus"]);
    if (!parentSku || !kidsRaw) continue;
    for (const k of kidsRaw.split(/[,;|\n\r\t]+/).map((s) => s.trim()).filter(Boolean)) {
      childToParent.set(k, parentSku);
    }
  }

  let mains = 0;
  let variants = 0;
  let reclassified = 0;
  let skippedLocked = 0;
  const nowIso = new Date().toISOString();

  for (const r of rows) {
    const raw = r.raw ?? {};
    const t = classifyType(pickCI(raw, ["_type", "typ", "product_type", "type"]));
    const explicitParent = pickCI(raw, ["parent_sku", "_parent_sku", "_parent", "parent"]);
    const inheritedParent = r.kod ? childToParent.get(r.kod) ?? null : null;
    const parent = explicitParent ?? inheritedParent ?? null;
    let kind: "main" | "variant" = "main";
    if (t === "variant" || parent) kind = "variant";
    if (t === "main" && !parent) kind = "main";
    if (kind === "variant") variants++; else mains++;

    if (kind !== "variant") continue;
    const currentKind = (r.row_kind ?? "main") as "main" | "variant";
    if (currentKind === "variant" && r.parent_sku === parent) continue;
    if (r.manual_lock) { skippedLocked++; continue; }

    const patch: Record<string, unknown> = {
      row_kind: "variant",
      parent_sku: parent,
      excluded: true,
      excluded_reason: "variant",
      excluded_at: nowIso,
    };
    const { error: upErr } = await (supabase as unknown as {
      from: (t: string) => { update: (p: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } };
    })
      .from("source_products")
      .update(patch)
      .eq("id", r.id);
    if (upErr) throw new Error(upErr.message);
    reclassified++;

    try {
      const { logProductEvent } = await import("./product-events.server");
      await logProductEvent(supabase as never, {
        projectId,
        productId: r.id,
        kind: "manual_edit",
        message: `Reklasyfikacja: wariant${parent ? ` (parent_sku=${parent})` : ""}`,
        meta: { action: "reclassify_variant", parent_sku: parent },
      });
    } catch { /* best-effort */ }
  }

  return { ok: true, mains, variants, reclassified, skippedLocked };
}

export const reclassifyVariants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    return reclassifyVariantsCore(context.supabase as never, data.projectId);
  });

const sourceProductSchema = z.object({
  ext_id: z.string().nullable(),
  nazwa: z.string().nullable(),
  kod: z.string().nullable(),
  ean: z.string().nullable(),
  category: z.string().nullable().optional(),
  has_images: z.boolean().optional(),
  main_image_url: z.string().nullable().optional(),
  gallery_urls: z.array(z.string()).optional(),
  row_kind: z.enum(["main", "variant"]).optional(),
  parent_sku: z.string().nullable().optional(),
  import_row_index: z.number().int().nullable().optional(),
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
      importMeta: z
        .object({
          headers: z.array(z.string()),
          filename: z.string(),
          sheet_name: z.string().nullable().optional(),
          format: z.enum(["csv", "xlsx"]),
          delimiter: z.string().nullable().optional(),
        })
        .optional(),
      overwriteImportMeta: z.boolean().optional(),
      rowIndexOffset: z.number().int().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const offset = data.rowIndexOffset ?? 0;
    const payload = data.rows.map((r, i) => {
      const {
        has_images: _hi,
        main_image_url: _mi,
        gallery_urls: _gu,
        category,
        row_kind,
        parent_sku,
        import_row_index,
        ...rest
      } = r;
      const kind = row_kind ?? "main";
      const base: Record<string, unknown> = {
        ...rest,
        category: category ?? null,
        project_id: data.projectId,
        row_kind: kind,
        parent_sku: parent_sku ?? null,
        import_row_index: import_row_index ?? offset + i,
      };
      // Variants are preserved for round-trip export but never processed by
      // the pipeline. Flag them as excluded on import; the flag is NOT
      // auto-cleared by re-running discovery (worker only clears
      // reason='auto_no_sources').
      if (kind === "variant") {
        base.excluded = true;
        base.excluded_reason = "variant";
        base.excluded_at = new Date().toISOString();
      }
      return base;
    });
    const { error } = await supabase.from("source_products").insert(payload as never);
    if (error) throw new Error(error.message);

    // Persist import shape once (first import wins) unless caller opts in.
    if (data.importMeta) {
      const { data: proj } = await supabase
        .from("projects")
        .select("settings")
        .eq("id", data.projectId)
        .maybeSingle();
      const settings = (proj?.settings as Record<string, unknown> | null) ?? {};
      const existing = settings.import_meta as unknown;
      if (!existing || data.overwriteImportMeta) {
        const nextSettings = { ...settings, import_meta: data.importMeta };
        await supabase
          .from("projects")
          .update({ settings: nextSettings } as never)
          .eq("id", data.projectId);
      }
    }

    // Create pending enrichments
    const { data: inserted } = await supabase
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean, row_kind")
      .eq("project_id", data.projectId);
    if (inserted) {
      const enr = (inserted as Array<{ id: string; row_kind?: string | null }>)
        .filter((row) => (row.row_kind ?? "main") !== "variant")
        .map((row) => ({
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
          // Store imported URLs on the source_product.raw payload (already
          // there via `raw`) and only mark the enrichment as "has media" via
          // the sentinel + pinned main. Do NOT write `ai_gallery_urls` —
          // that column is reserved for AI visualizations and would make
          // imported photos appear in the "Wizualizacje AI" section.
          const mainUrl = imgs.main ?? imgs.gallery[0] ?? null;
          if (!mainUrl) continue;
          // Ordered list of client-imported image URLs (main first, then
          // gallery), deduped. Persist alongside the pinned-main sentinel so
          // getVisibleGallery can surface them as tier-0 "client_owned"
          // images independent of matched sources.
          const importedImages: string[] = [];
          const importedSeen = new Set<string>();
          const pushIfNew = (u: string | null | undefined) => {
            if (!u || typeof u !== "string") return;
            const t = u.trim();
            if (!t || !/^https?:\/\//i.test(t)) return;
            if (importedSeen.has(t)) return;
            importedSeen.add(t);
            importedImages.push(t);
          };
          pushIfNew(imgs.main);
          for (const g of imgs.gallery) pushIfNew(g);
          // Merge with any existing image_meta to preserve prior probes.
          const { data: exEnr } = await supabase
            .from("enrichments")
            .select("image_meta")
            .eq("source_product_id", p.id)
            .maybeSingle();
          const prevMeta = (((exEnr as { image_meta?: Record<string, unknown> } | null)?.image_meta) ?? {}) as Record<string, unknown>;
          const nextMeta = { ...prevMeta, imported_images: importedImages };
          const patch: Record<string, unknown> = {
            regenerated_main_image: "__imported__",
            pinned_main_url: mainUrl,
            image_meta: nextMeta,
          };
          const { error: mErr } = await supabase
            .from("enrichments")
            .update(patch as never)
            .eq("source_product_id", p.id);
          if (mErr) throw new Error(mErr.message);
        }
      }
    }
    const variants = payload.filter((p) => (p as { row_kind?: string }).row_kind === "variant").length;
    return { inserted: payload.length, mains: payload.length - variants, variants };
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
  category: z.string().nullable().optional(),
});

type RemapField = "ext_id" | "nazwa" | "kod" | "ean" | "category";

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
      .select("id, ext_id, nazwa, kod, ean, category")
      .eq("project_id", data.projectId)
      .limit(50000);
    if (error) throw new Error(error.message);

    const byKey = new Map<string, { id: string; ext_id: string | null; nazwa: string | null; kod: string | null; ean: string | null; category: string | null }>();
    for (const p of products ?? []) {
      const k = normalizeKey(data.keyField, (p as Record<string, string | null>)[data.keyField]);
      if (k && !byKey.has(k)) byKey.set(k, p);
    }

    let matched = 0;
    let unmatched = 0;
    let updated = 0;
    let skipped = 0;

    const fields: RemapField[] = ["ext_id", "nazwa", "kod", "ean", "category"];

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

    // Reclassify variants using the (now possibly refreshed) raw payloads.
    // No-op when the original import lacked hierarchy columns.
    let reclassify: Awaited<ReturnType<typeof reclassifyVariantsCore>> | null = null;
    try {
      reclassify = await reclassifyVariantsCore(supabase as never, data.projectId);
    } catch (e) {
      console.warn("[updateSourceProductsFromCsv] reclassify failed:", e instanceof Error ? e.message : String(e));
    }
    return { matched, unmatched, updated, skipped, total: data.rows.length, reclassify };
  });