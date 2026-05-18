import Papa from "papaparse";

export type CsvRow = {
  ext_id: string | null;
  nazwa: string | null;
  kod: string | null;
  ean: string | null;
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

export const parseCsv = (file: File): Promise<CsvRow[]> =>
  new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows: CsvRow[] = res.data.map((r) => ({
          ext_id: pick(r, ["id", "ID", "product_id", "sku_id"]),
          nazwa: pick(r, ["nazwa", "name", "title", "product_name"]),
          kod: pick(r, ["kod", "code", "sku"]),
          ean: pick(r, ["ean", "gtin", "barcode"]),
          raw: r,
        }));
        resolve(rows.filter((r) => r.nazwa || r.ean || r.kod || r.ext_id));
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
  raw: Record<string, unknown>;
};

const collectImages = (o: Record<string, unknown>): string[] => {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) out.push(v);
    else if (v && typeof v === "object") {
      const cand = (v as Record<string, unknown>).url ?? (v as Record<string, unknown>).src;
      if (typeof cand === "string") out.push(cand);
    }
  };
  for (const key of ["images", "image", "photos", "gallery", "image_urls", "imageUrls"]) {
    const v = o[key];
    if (Array.isArray(v)) v.forEach(push);
    else push(v);
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
  const handle = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const url = firstString(o, ["url", "link", "sourceUrl", "source_url", "product_url"]);
    if (!url) return;
    out.push({
      url,
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
      images: collectImages(o),
      raw: o,
    });
  };
  if (Array.isArray(raw)) raw.forEach(handle);
  else if (raw && typeof raw === "object") {
    // Either single object or map {url: data}
    const o = raw as Record<string, unknown>;
    if (typeof o.url === "string") handle(o);
    else {
      for (const v of Object.values(o)) handle(v);
    }
  }
  return out;
};