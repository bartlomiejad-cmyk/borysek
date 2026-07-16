import Papa from "papaparse";
import * as XLSX from "xlsx";

export type CsvRow = {
  ext_id: string | null;
  nazwa: string | null;
  kod: string | null;
  ean: string | null;
  category: string | null;
  has_images?: boolean;
  main_image_url?: string | null;
  gallery_urls?: string[];
  row_kind?: "main" | "variant";
  parent_sku?: string | null;
  raw: Record<string, unknown>;
};

const pick = (row: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const lk = k.toLowerCase();
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === lk) {
        const v = row[rk];
        if (v === null || v === undefined || v === "") continue;
        return String(v).trim();
      }
    }
  }
  return null;
};

export type CsvMapping = {
  id_column?: string;
  name_column?: string;
  code_column?: string;
  ean_column?: string;
  category_column?: string;
};

/**
 * Normalize a hierarchical category string. Accepts common separators
 * (`>>`, `>`, `/`, `|`, `\`) and returns a canonical path like
 * `"Supermarket > Worki na śmieci"`. Returns null when empty.
 */
export const normalizeCategoryPath = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const parts = s
    .split(/\s*(?:>>+|>|\/|\||\\)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.join(" > ");
};

/** Extract the last segment of a normalized path — used as a compact chip label. */
export const categoryLeaf = (path: string | null | undefined): string | null => {
  if (!path) return null;
  const parts = path.split(">").map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? null;
};

export const parseCsv = (file: File, mapping?: CsvMapping): Promise<CsvRow[]> =>
  new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const m = mapping ?? {};
        const lookup = (
          row: Record<string, unknown>,
          manual: string | undefined,
          fallback: string[],
        ): string | null => {
          if (manual && manual.trim()) {
            const v = pick(row, [manual.trim()]);
            if (v) return v;
          }
          return pick(row, fallback);
        };
        const rows: CsvRow[] = res.data.map((r) => ({
          ext_id: lookup(r, m.id_column, ["id", "ID", "product_id", "sku_id"]),
          nazwa: lookup(r, m.name_column, ["nazwa", "name", "title", "product_name"]),
          kod: lookup(r, m.code_column, ["kod", "code", "sku"]),
          ean: lookup(r, m.ean_column, ["ean", "gtin", "barcode"]),
          category: normalizeCategoryPath(
            lookup(r, m.category_column, [
              "kategoria",
              "kategoria_pelna",
              "kategoria_glowna",
              "kategorie",
              "category",
              "categories",
              "category_path",
              "categorypath",
              "grupa",
              "group",
              "groups",
              "dzial",
              "section",
            ]),
          ),
          raw: r,
        }));
        resolve(rows.filter((r) => r.nazwa || r.ean || r.kod || r.ext_id));
      },
      error: (err) => reject(err),
    });
  });

export type RawCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
};

export type RawImport = RawCsv & {
  filename: string;
  format: "csv" | "xlsx";
  sheet_name: string | null;
  delimiter: string | null;
};

export type ExplicitCsvMapping = {
  id_column?: string | null;
  name_column?: string | null;
  code_column?: string | null;
  ean_column?: string | null;
  category_column?: string | null;
  main_image_column?: string | null;
  gallery_column?: string | null;
  type_column?: string | null;
  parent_sku_column?: string | null;
  children_column?: string | null;
};

/**
 * Build CsvRow[] from already-parsed RawCsv using an explicit column mapping
 * (header → field). Unlike `parseCsv`, does NOT fall back to common aliases —
 * only the selected columns are read. Empty/unset mappings yield `null`.
 */
export const buildCsvRowsFromMapping = (
  raw: RawCsv,
  mapping: ExplicitCsvMapping,
): CsvRow[] => {
  const get = (row: Record<string, string>, col?: string | null) => {
    if (!col) return null;
    const v = row[col];
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t === "" ? null : t;
  };
  const splitUrls = (v: string | null): string[] => {
    if (!v) return [];
    return v
      .split(/[,|\n\r\t]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
  };
  const extractImages = (r: Record<string, string>) => {
    const mainRaw = get(r, mapping.main_image_column);
    const galleryRaw = get(r, mapping.gallery_column);
    const gallery = splitUrls(galleryRaw);
    const mainCandidates = splitUrls(mainRaw);
    let main: string | null = mainCandidates[0] ?? null;
    if (!main && gallery.length) main = gallery[0];
    const combined: string[] = [];
    const seen = new Set<string>();
    for (const u of [main, ...gallery, ...mainCandidates]) {
      if (!u) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      combined.push(u);
    }
    return { main, gallery: combined };
  };
  // Auto-detect hierarchy columns when not explicitly mapped. Common
  // WooCommerce/CSV conventions: _type / typ / product_type; _children;
  // parent_sku / _parent.
  const findHeader = (candidates: string[]): string | null => {
    const lc = raw.headers.map((h) => h.toLowerCase());
    for (const c of candidates) {
      const idx = lc.indexOf(c.toLowerCase());
      if (idx >= 0) return raw.headers[idx];
    }
    return null;
  };
  const typeCol =
    mapping.type_column ?? findHeader(["_type", "typ", "product_type", "type"]);
  const childrenCol =
    mapping.children_column ?? findHeader(["_children", "children", "variant_skus"]);
  const parentSkuCol =
    mapping.parent_sku_column ??
    findHeader(["parent_sku", "_parent_sku", "_parent", "parent"]);

  const classifyType = (v: string | null): "main" | "variant" | null => {
    if (!v) return null;
    const t = v.trim().toLowerCase();
    if (!t) return null;
    if (t.includes("variation") || t.includes("wariant")) return "variant";
    // WooCommerce style: SIMPLE-PRODUCT is a child of VARIABLE-PRODUCT
    // when a parent row references it via _children. We can't decide from
    // type alone; leave classification to the child-lookup pass.
    if (t === "variable" || t.includes("variable-product") || t === "variable_product")
      return "main";
    return null;
  };

  // First pass: collect SKU → parent_sku map from _children columns on
  // parent rows, and gather variant EANs to bubble up to the parent row.
  const childToParent = new Map<string, string>();
  const variantEansByParent = new Map<string, string[]>();
  const skuOfRow = (r: Record<string, string>) => get(r, mapping.code_column);
  const eanOfRow = (r: Record<string, string>) => get(r, mapping.ean_column);
  if (childrenCol) {
    for (const r of raw.rows) {
      const parentSku = skuOfRow(r);
      const kidsRaw = get(r, childrenCol);
      if (!parentSku || !kidsRaw) continue;
      const kids = kidsRaw
        .split(/[,;|\n\r\t]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const k of kids) childToParent.set(k, parentSku);
    }
  }

  const rowKindByIndex: Array<"main" | "variant"> = [];
  const parentByIndex: Array<string | null> = [];
  raw.rows.forEach((r, i) => {
    const sku = skuOfRow(r);
    const t = classifyType(typeCol ? get(r, typeCol) : null);
    const explicitParent = parentSkuCol ? get(r, parentSkuCol) : null;
    const inheritedParent = sku ? (childToParent.get(sku) ?? null) : null;
    let parent: string | null = explicitParent ?? inheritedParent ?? null;
    let kind: "main" | "variant" = "main";
    if (t === "variant" || parent) kind = "variant";
    if (t === "main" && !parent) kind = "main";
    // A row explicitly typed as parent/variable stays main even if it
    // appears as a child of itself in a malformed file.
    if (kind === "variant" && parent) {
      const ean = eanOfRow(r);
      if (ean) {
        const list = variantEansByParent.get(parent) ?? [];
        if (!list.includes(ean)) list.push(ean);
        variantEansByParent.set(parent, list);
      }
    } else if (kind === "variant") {
      parent = null; // variant with no discoverable parent → still mark, no link
    }
    rowKindByIndex[i] = kind;
    parentByIndex[i] = parent;
  });

  const rows: CsvRow[] = raw.rows.map((r, i) => {
    const imgs = extractImages(r);
    const kind = rowKindByIndex[i];
    const parent_sku = parentByIndex[i];
    const sku = skuOfRow(r);
    const rawWithMeta: Record<string, unknown> = { ...r };
    if (kind === "main" && sku) {
      const eans = variantEansByParent.get(sku);
      if (eans && eans.length) rawWithMeta.variant_eans = eans;
    }
    return {
      ext_id: get(r, mapping.id_column),
      nazwa: get(r, mapping.name_column),
      kod: get(r, mapping.code_column),
      ean: get(r, mapping.ean_column),
      category: normalizeCategoryPath(get(r, mapping.category_column)),
      has_images: !!imgs.main || imgs.gallery.length > 0,
      main_image_url: imgs.main,
      gallery_urls: imgs.gallery,
      row_kind: kind,
      parent_sku,
      raw: rawWithMeta,
    };
  });
  return rows.filter((r) => r.nazwa || r.ean || r.kod || r.ext_id);
};

/**
 * Parse a CSV file into raw headers + string rows. Used for the post-import
 * column remap dialog, where the user picks which CSV column maps to which
 * product field at runtime.
 */
export const parseCsvRaw = (file: File): Promise<RawCsv> =>
  new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const headers = (res.meta.fields ?? []).map((h) => String(h));
        const rows = res.data.map((r) => {
          const out: Record<string, string> = {};
          for (const k of Object.keys(r)) {
            const v = r[k];
            out[k] = v === null || v === undefined ? "" : String(v).trim();
          }
          return out;
        });
        resolve({ headers, rows });
      },
      error: (err) => reject(err),
    });
  });

export type SearchRow = { term: string; organic_urls: string[] };

/**
 * Flexible Search JSON parser. Accepts common shapes:
 * - Array of objects with searchQuery.term + organicResults[].url
 * - Array of { term, organicResults: [{ url }] } or { term, urls: [] }
 * - Object map: { [term]: string[] | { url }[] }
 */
export const parseSearchJson = (raw: unknown): SearchRow[] => {
  const out: SearchRow[] = [];
  const pushRow = (term: unknown, urls: unknown) => {
    if (typeof term !== "string" || !term.trim()) return;
    const list: string[] = [];
    if (Array.isArray(urls)) {
      for (const u of urls) {
        if (typeof u === "string") list.push(u);
        else if (u && typeof u === "object") {
          const cand = (u as Record<string, unknown>).url ?? (u as Record<string, unknown>).link;
          if (typeof cand === "string") list.push(cand);
        }
      }
    }
    out.push({ term: term.trim(), organic_urls: list });
  };

  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object") {
      const o = node as Record<string, unknown>;
      const sq = o.searchQuery as Record<string, unknown> | undefined;
      const termVal = (sq && (sq.term as string)) || (o.term as string) || (o.query as string);
      const organic =
        (o.organicResults as unknown) ||
        (o.organic_results as unknown) ||
        (o.results as unknown) ||
        (o.urls as unknown);
      if (termVal && organic) {
        pushRow(termVal, organic);
        return;
      }
    }
  };

  if (Array.isArray(raw)) {
    visit(raw);
  } else if (raw && typeof raw === "object") {
    // Object map form
    const o = raw as Record<string, unknown>;
    let hasShape = false;
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v) && v.length && (typeof v[0] === "string" || typeof v[0] === "object")) {
        pushRow(k, v);
        hasShape = true;
      }
    }
    if (!hasShape) visit(raw);
  }
  return out;
};

export type ProductSourceRow = {
  url: string;
  title: string | null;
  description: string | null;
  images: string[];
  extra_images: string[];
  raw: Record<string, unknown>;
};

const pushImage = (out: string[], v: unknown) => {
  if (typeof v === "string" && /^https?:\/\//i.test(v)) out.push(v);
  else if (v && typeof v === "object") {
    const cand =
      (v as Record<string, unknown>).url ??
      (v as Record<string, unknown>).src ??
      (v as Record<string, unknown>).href;
    if (typeof cand === "string" && /^https?:\/\//i.test(cand)) out.push(cand);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const collectMainImages = (o: Record<string, unknown>): string[] => {
  const out: string[] = [];
  for (const key of ["images", "image", "photos", "gallery", "image_urls", "imageUrls"]) {
    const v = o[key];
    if (Array.isArray(v)) v.forEach((x) => pushImage(out, x));
    else pushImage(out, v);
  }
  return Array.from(new Set(out));
};

const collectExtraImages = (o: Record<string, unknown>): string[] => {
  const out: string[] = [];
  for (const key of ["additionalProperties", "extraProperties", "extra_properties", "additional_properties"]) {
    const ap = o[key] as Record<string, unknown> | undefined;
    if (!ap || typeof ap !== "object") continue;
    const apImgs = ap.images ?? ap.image ?? ap.photos ?? ap.gallery;
    if (Array.isArray(apImgs)) apImgs.forEach((x) => pushImage(out, x));
    else pushImage(out, apImgs);
  }
  return Array.from(new Set(out));
};

const firstString = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

export const parseProductJson = (raw: unknown): ProductSourceRow[] => {
  const out: ProductSourceRow[] = [];
  const seenNodes = new WeakSet<object>();
  const handle = (node: unknown, fallbackUrl?: string) => {
    if (!isRecord(node)) return false;
    const o = node;
    const url = firstString(o, ["url", "link", "sourceUrl", "source_url", "product_url"]) ?? fallbackUrl ?? null;
    if (!url) return;
    const main = collectMainImages(o);
    const extra = collectExtraImages(o).filter((u) => !main.includes(u));
    out.push({
      url: url.trim(),
      title: firstString(o, ["title", "name", "productName", "product_name", "h1"]),
      description: firstString(o, [
        "description",
        "fullDescription",
        "full_description",
        "longDescription",
        "long_description",
        "text",
        "content",
      ]),
      images: main,
      extra_images: extra,
      raw: o,
    });
    return true;
  };
  const visit = (node: unknown, fallbackUrl?: string) => {
    if (!node || typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, fallbackUrl));
      return;
    }
    if (handle(node, fallbackUrl)) return;
    for (const [key, value] of Object.entries(node)) {
      const nextFallback = /^https?:\/\//i.test(key) ? key : fallbackUrl;
      visit(value, nextFallback);
    }
  };
  visit(raw);
  return out;
};