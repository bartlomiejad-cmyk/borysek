import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pickThumbsForList, type ImageMeta } from "./images";
import { getVisibleGallery, type GalleryImageScore } from "./gallery";
import { sanitizeAllegroHtml } from "./seo";

// Header patterns that MUST NEVER be overwritten regardless of mapping.
const BLOCK_PATTERNS = [
  /(^|_)ean(_|$)/i,
  /gtin/i,
  /(^|_)sku(_|$)/i,
  /symbol/i,
  /(^|_)kod(_|$)/i,
  /(^|_)id(_|$)/i,
  /^_type$/i,
  /^_children$/i,
  /^_bindings$/i,
  /_sku$/i,
];

export const isBlockedHeader = (h: string): boolean =>
  BLOCK_PATTERNS.some((re) => re.test(h.trim()));

export type RoundtripMapping = {
  // header (from import_meta.headers) → generated field key
  updates: Record<string, RoundtripSourceField>;
  // ordered list of appended-column keys to include at the end
  appended: RoundtripAppendedKey[];
  propagateToVariants: boolean;
  approvedOnly: boolean;
};

export const ROUNDTRIP_SOURCE_FIELDS = [
  "golden_name",
  "golden_description",
  "golden_meta_description",
  "golden_slug",
  "opis_allegro",
  "kategoria",
] as const;
export type RoundtripSourceField = (typeof ROUNDTRIP_SOURCE_FIELDS)[number];

export const ROUNDTRIP_APPENDED = [
  { key: "opis_html", label: "opis_html" },
  { key: "opis_allegro", label: "opis_allegro" },
  { key: "cechy", label: "cechy" },
  { key: "slowa_kluczowe", label: "slowa_kluczowe" },
  { key: "miniatura_url", label: "miniatura_url" },
  { key: "wizualizacje_urls", label: "wizualizacje_urls" },
  { key: "galeria_urls", label: "galeria_urls" },
  { key: "kategoria", label: "kategoria" },
] as const;
export type RoundtripAppendedKey = (typeof ROUNDTRIP_APPENDED)[number]["key"];

type ImportMeta = {
  headers: string[];
  filename: string;
  sheet_name: string | null;
  format: "csv" | "xlsx";
  delimiter: string | null;
};

type GeneratedRecord = {
  approved: boolean;
  values: Partial<Record<RoundtripSourceField, string>>;
  appended: Partial<Record<RoundtripAppendedKey, string>>;
};

export const exportRoundtrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        mapping: z.object({
          updates: z.record(z.string(), z.enum(ROUNDTRIP_SOURCE_FIELDS)),
          appended: z.array(z.enum(ROUNDTRIP_APPENDED.map((a) => a.key) as unknown as [string, ...string[]])),
          propagateToVariants: z.boolean().default(true),
          approvedOnly: z.boolean().default(false),
        }),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: proj } = await supabase
      .from("projects")
      .select("settings, include_extra_images")
      .eq("id", data.projectId)
      .single();
    const settings = (proj?.settings as Record<string, unknown> | null) ?? {};
    const meta = settings.import_meta as ImportMeta | undefined;
    if (!meta || !Array.isArray(meta.headers) || meta.headers.length === 0) {
      throw new Error(
        "Brak zapisanej struktury importu (import_meta). Zaimportuj plik od nowa, aby użyć eksportu round-trip.",
      );
    }

    // Persist mapping for reuse.
    await supabase
      .from("projects")
      .update({
        settings: { ...settings, roundtrip_mapping: data.mapping },
      } as never)
      .eq("id", data.projectId);

    const includeExtra = !!(proj as { include_extra_images?: boolean } | null)?.include_extra_images;

    // Fetch every product row for the project (mains + variants), ordered by import_row_index.
    const products: Array<Record<string, unknown>> = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from("source_products")
        .select(
          "id, ext_id, nazwa, kod, ean, category, raw, row_kind, parent_sku, review_status, import_row_index, created_at",
        )
        .eq("project_id", data.projectId)
        .order("import_row_index", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!page || page.length === 0) break;
      products.push(...(page as Array<Record<string, unknown>>));
      if (page.length < PAGE) break;
    }
    if (!products.length) return { headers: [], rows: [], filename: meta.filename, sheet_name: meta.sheet_name, format: meta.format, delimiter: meta.delimiter };

    const ids = products.map((p) => p.id as string);
    const { data: ens } = await supabase
      .from("enrichments")
      .select(
        "source_product_id, golden_name, golden_description, golden_meta_description, golden_slug, golden_seo_keywords, golden_features, allegro_description, ai_gallery_urls, regenerated_main_image, pinned_main_url, hidden_images, image_scores, image_meta, picked_urls",
      )
      .eq("project_id", data.projectId)
      .in("source_product_id", ids)
      .limit(100000);
    const enMap = new Map<string, Record<string, unknown>>();
    for (const e of ens ?? []) enMap.set((e as { source_product_id: string }).source_product_id, e as Record<string, unknown>);

    // product_sources for gallery URL resolution.
    const imgMap = new Map<string, string[]>();
    for (let from = 0; ; from += PAGE) {
      const { data: page } = await supabase
        .from("product_sources")
        .select("url, images, extra_images")
        .eq("project_id", data.projectId)
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      for (const s of page) {
        const main = Array.isArray((s as { images?: unknown }).images) ? ((s as { images: string[] }).images) : [];
        const extra = includeExtra && Array.isArray((s as { extra_images?: unknown }).extra_images)
          ? ((s as { extra_images: string[] }).extra_images)
          : [];
        imgMap.set((s as { url: string }).url, [...main, ...extra]);
      }
      if (page.length < PAGE) break;
    }

    const generated = new Map<string, GeneratedRecord>();
    for (const p of products) {
      const id = p.id as string;
      const e = enMap.get(id) ?? {};
      const feats = ((e.golden_features as Array<{ key: string; value: string }> | undefined) ?? []);
      const featuresText = feats
        .map((f) => `${f.key ?? ""}: ${f.value ?? ""}`.trim())
        .filter(Boolean)
        .join(" | ");
      const keywords = ((e.golden_seo_keywords as string[] | undefined) ?? []).join(" | ");
      const allegro = sanitizeAllegroHtml(((e.allegro_description as string | undefined) ?? ""));
      const ai = ((e.ai_gallery_urls as string[] | undefined) ?? []);
      const regen = (e.regenerated_main_image as string | undefined) ?? "";
      const regenClean = regen && regen !== "__imported__" ? regen : "";
      const pinned = ((e.pinned_main_url as string | null | undefined) ?? "") as string;
      const thumb = regenClean || pinned;
      const picked = ((e.picked_urls as string[] | undefined) ?? []);
      const hidden = new Set(((e.hidden_images as string[] | undefined) ?? []));
      const scores = ((e.image_scores as Record<string, GalleryImageScore> | undefined) ?? {});
      const imgMeta = ((e.image_meta as ImageMeta | undefined) ?? {});
      const all: string[] = [];
      for (const u of picked) for (const img of imgMap.get(u) ?? []) if (!all.includes(img)) all.push(img);
      const { accepted } = getVisibleGallery(all, {
        hidden_images: Array.from(hidden),
        image_scores: scores,
        pinned_main_url: pinned || null,
      });
      const list = pickThumbsForList(accepted, imgMeta, hidden, pinned || null, 24);
      const galleryUrls = list.filter((u) => !scores[u]?.dead).join(";");
      const rec: GeneratedRecord = {
        approved: (p.review_status as string | null) === "APPROVED",
        values: {
          golden_name: (e.golden_name as string | null) ?? "",
          golden_description: (e.golden_description as string | null) ?? "",
          golden_meta_description: (e.golden_meta_description as string | null) ?? "",
          golden_slug: (e.golden_slug as string | null) ?? "",
          opis_allegro: allegro,
          kategoria: (p.category as string | null) ?? "",
        },
        appended: {
          opis_html: (e.golden_description as string | null) ?? "",
          opis_allegro: allegro,
          cechy: featuresText,
          slowa_kluczowe: keywords,
          miniatura_url: thumb,
          wizualizacje_urls: ai.join(";"),
          galeria_urls: galleryUrls,
          kategoria: (p.category as string | null) ?? "",
        },
      };
      generated.set(id, rec);
    }

    // Build parent lookup: parent SKU (kod) → generated record.
    const genByParentSku = new Map<string, GeneratedRecord>();
    for (const p of products) {
      if ((p.row_kind as string | null) === "variant") continue;
      const kod = (p.kod as string | null) ?? "";
      if (!kod) continue;
      const g = generated.get(p.id as string);
      if (g) genByParentSku.set(kod, g);
    }

    const blocked = new Set(meta.headers.filter((h) => isBlockedHeader(h)));
    const validUpdates: Array<[string, RoundtripSourceField]> = [];
    for (const [h, f] of Object.entries(data.mapping.updates)) {
      if (!meta.headers.includes(h)) continue;
      if (blocked.has(h)) continue;
      validUpdates.push([h, f]);
    }
    const appendedHeaders = data.mapping.appended.filter(
      (k, i, arr) => arr.indexOf(k) === i,
    );

    const finalHeaders = [...meta.headers, ...appendedHeaders];
    const rows: Array<Record<string, string>> = [];
    for (const p of products) {
      const raw = ((p.raw as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      const isVariant = (p.row_kind as string | null) === "variant";
      let g = generated.get(p.id as string);
      if (isVariant && data.mapping.propagateToVariants) {
        const parentSku = (p.parent_sku as string | null) ?? null;
        if (parentSku) {
          const pg = genByParentSku.get(parentSku);
          if (pg) g = pg;
        }
      }
      const passThrough = data.mapping.approvedOnly && g && !g.approved;
      const out: Record<string, string> = {};
      // Start with original values in original order.
      for (const h of meta.headers) {
        const v = raw[h];
        out[h] = v === null || v === undefined ? "" : String(v);
      }
      if (g && !passThrough) {
        for (const [h, field] of validUpdates) {
          const newVal = g.values[field] ?? "";
          if (newVal && String(newVal).trim() !== "") out[h] = String(newVal);
          // else: preserve original cell
        }
      }
      for (const k of appendedHeaders as RoundtripAppendedKey[]) {
        if (isVariant && !data.mapping.propagateToVariants) {
          out[k] = "";
        } else if (g && !passThrough) {
          out[k] = g.appended[k] ?? "";
        } else {
          out[k] = "";
        }
      }
      rows.push(out);
    }

    return {
      headers: finalHeaders,
      rows,
      filename: meta.filename,
      sheet_name: meta.sheet_name,
      format: meta.format,
      delimiter: meta.delimiter,
    };
  });