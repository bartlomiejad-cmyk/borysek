import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ExtractResult = {
  url: string;
  ok: boolean;
  sourceProductId?: string;
  name?: string;
  error?: string;
};

const EXTRACT_MODEL = "google/gemini-2.5-flash";

const ExtractSchema = z.object({
  nazwa: z.string().max(300).default(""),
  producent: z.string().max(160).default(""),
  marka: z.string().max(160).default(""),
  kod: z.string().max(120).default(""),
  kod_producenta: z.string().max(120).default(""),
  ean: z.string().max(60).default(""),
  product_description: z.string().max(4000).default(""),
  product_features: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        value: z.string().min(1).max(2000),
      }),
    )
    .max(60)
    .default([]),
  product_image_indexes: z.array(z.number()).max(30).default([]),
  is_product_page: z.boolean().default(true),
  rejected_reason: z.string().max(500).optional().default(""),
});

async function callGatewayJson(
  apiKey: string,
  model: string,
  messages: unknown[],
): Promise<unknown> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!res.ok) {
    throw new Error(`AI gateway ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = j.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
}

function parseJsonLdProducts(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item === "object") {
          const t = (item as { "@type"?: unknown })["@type"];
          const isProduct =
            (typeof t === "string" && t.toLowerCase().includes("product")) ||
            (Array.isArray(t) && t.some((x) => typeof x === "string" && x.toLowerCase().includes("product")));
          if (isProduct) out.push(item as Record<string, unknown>);
          // Some sites nest a Product inside a Graph.
          const g = (item as { "@graph"?: unknown })["@graph"];
          if (Array.isArray(g)) {
            for (const node of g) {
              if (node && typeof node === "object") {
                const nt = (node as { "@type"?: unknown })["@type"];
                const nIsProduct =
                  (typeof nt === "string" && nt.toLowerCase().includes("product")) ||
                  (Array.isArray(nt) && nt.some((x) => typeof x === "string" && x.toLowerCase().includes("product")));
                if (nIsProduct) out.push(node as Record<string, unknown>);
              }
            }
          }
        }
      }
    } catch {
      // ignore invalid JSON blocks
    }
  }
  return out;
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function jsonLdHints(products: Array<Record<string, unknown>>): {
  name: string;
  sku: string;
  gtin: string;
  description: string;
  brand: string;
  mpn: string;
} {
  if (!products.length) return { name: "", sku: "", gtin: "", description: "", brand: "", mpn: "" };
  const p = products[0];
  const gtin = firstString(
    p["gtin13"],
    p["gtin"],
    p["gtin12"],
    p["gtin8"],
    p["gtin14"],
  );
  const brandRaw = p["brand"];
  const brand =
    typeof brandRaw === "string"
      ? brandRaw
      : brandRaw && typeof brandRaw === "object"
        ? firstString((brandRaw as Record<string, unknown>)["name"])
        : "";
  return {
    name: firstString(p["name"]),
    sku: firstString(p["sku"], p["mpn"], p["productID"]),
    gtin,
    description: firstString(p["description"]),
    brand,
    mpn: firstString(p["mpn"]),
  };
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const JUNK_NAMES = [
  "recaptcha",
  "captcha",
  "cloudflare",
  "just a moment",
  "attention required",
  "access denied",
  "403 forbidden",
  "404 not found",
  "not found",
  "robot check",
  "verify you are human",
  "checking your browser",
];

function isJunkName(s: string): boolean {
  const n = s.trim().toLowerCase();
  if (n.length < 3) return true;
  return JUNK_NAMES.some((j) => n === j || n.includes(j));
}

function looksLikeChallengePage(
  rawHtml: string,
  markdown: string,
  title: string,
): boolean {
  const hay = `${title}\n${markdown.slice(0, 4000)}\n${rawHtml.slice(0, 8000)}`.toLowerCase();
  const markers = [
    "g-recaptcha",
    "grecaptcha",
    "recaptcha/api.js",
    "hcaptcha",
    "cf-challenge",
    "cf-browser-verification",
    "challenge-platform",
    "just a moment",
    "checking your browser",
    "attention required",
    "access denied",
    "please verify you are human",
  ];
  return markers.some((m) => hay.includes(m));
}

function extractProductH1(rawHtml: string): string {
  if (!rawHtml) return "";
  const re = /<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi;
  const all: Array<{ classAttr: string; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawHtml))) {
    const classMatch = m[1].match(/class\s*=\s*["']([^"']*)["']/i);
    const cls = classMatch ? classMatch[1].toLowerCase() : "";
    const text = stripTags(m[2]);
    if (!text) continue;
    all.push({ classAttr: cls, text });
  }
  if (!all.length) return "";
  // Prefer product-flavoured class names.
  const preferred = all.find((h) =>
    /(product|item)[-_ ]?(name|title|header)/.test(h.classAttr),
  );
  if (preferred && !isJunkName(preferred.text)) return preferred.text;
  // Otherwise first non-junk H1.
  const first = all.find((h) => !isJunkName(h.text));
  return first?.text ?? "";
}

function extractHtmlTitle(rawHtml: string): string {
  if (!rawHtml) return "";
  const m = rawHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  const t = stripTags(m[1]);
  return isJunkName(t) ? "" : t;
}

function extractPageTitle(
  meta: Record<string, unknown>,
  rawHtml: string,
): string {
  const candidates = [
    meta.title,
    meta.ogTitle,
    (meta as Record<string, unknown>)["og:title"],
    meta.twitterTitle,
    (meta as Record<string, unknown>)["twitter:title"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && !isJunkName(c)) return c.trim();
  }
  return extractHtmlTitle(rawHtml);
}

export const importProductsFromUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        urls: z.array(z.string().url()).min(1).max(20),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ results: ExtractResult[] }> => {
    const { supabase } = context;
    const fcKey = process.env.FIRECRAWL_API_KEY;
    if (!fcKey) throw new Error("FIRECRAWL_API_KEY nie jest skonfigurowany");
    const aiKey = process.env.LOVABLE_API_KEY;

    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const { pickImagesFromScrape } = await import("./_workers.server");
    const { extractDescriptionSection, sanitizeProductDescription, filterImageUrls } =
      await import("./source-cleanup");

    const firecrawl = new Firecrawl({ apiKey: fcKey });

    // Deduplicate URLs preserving order.
    const urls = Array.from(new Set(data.urls.map((u) => u.trim()))).filter(Boolean);

    // Process in parallel with a small concurrency cap so we stay within
    // Cloudflare Worker time budget. The client sends small batches (~5 URLs).
    const results = await Promise.all(
      urls.map(async (url): Promise<ExtractResult> => {
        try {
          const scrape = (await firecrawl.scrape(url, {
            formats: ["markdown", "rawHtml"],
            onlyMainContent: true,
          } as never)) as Record<string, unknown>;

          const meta = (scrape.metadata ?? {}) as Record<string, unknown>;
          const rawMarkdown =
            typeof scrape.markdown === "string" ? scrape.markdown : "";
          const rawHtml =
            typeof scrape.rawHtml === "string"
              ? scrape.rawHtml
              : typeof scrape.html === "string"
                ? (scrape.html as string)
                : "";
          const pageTitle = extractPageTitle(meta, rawHtml) || null;
          const h1Title = extractProductH1(rawHtml);

          if (looksLikeChallengePage(rawHtml, rawMarkdown, pageTitle ?? "")) {
            return {
              url,
              ok: false,
              error:
                "Strona zablokowana przez zabezpieczenia antybotowe (reCAPTCHA/Cloudflare). Spróbuj innego linku lub uruchom import ponownie.",
            };
          }

          const candidateImages = pickImagesFromScrape(scrape);
          const jsonLd = parseJsonLdProducts(rawHtml);
          const hints = jsonLdHints(jsonLd);

          const focusedMd = extractDescriptionSection(rawMarkdown) ?? rawMarkdown;
          const cappedImages = candidateImages.slice(0, 20);

          let extracted: z.infer<typeof ExtractSchema> = {
            nazwa: hints.name,
            producent: hints.brand,
            marka: hints.brand,
            kod: hints.sku,
            kod_producenta: hints.mpn || hints.sku,
            ean: hints.gtin,
            product_description: hints.description,
            product_features: [],
            product_image_indexes: cappedImages.map((_, i) => i + 1),
            is_product_page: true,
            rejected_reason: "",
          };

          if (aiKey) {
            const system = [
              "Jesteś ekstraktorem danych produktowych z pojedynczej strony sklepu / producenta.",
              "Zwróć WYŁĄCZNIE dane opisujące GŁÓWNY produkt tej strony (nie polecane, nie kategorie, nie inne warianty).",
              "POMIŃ BEZWZGLĘDNIE (to NIE dane produktu):",
              "- logo płatności (Blik, Visa, Mastercard, PayU, Przelewy24, PayPal, Google/Apple Pay)",
              "- logo sklepu, ikony social (Facebook, Instagram, YouTube, TikTok), przyciski „Kup teraz\", newsletter",
              "- informacje o wysyłce, płatnościach, zwrotach, gwarancji, telefonach i e‑mailach sklepu, adresach sklepów stacjonarnych",
              "- polecane / „zobacz też\" / „klienci kupili\", recenzje, kategorie, regulaminy, stopki",
              "- angielskie chrome sklepu: SKU, UPC, Current Stock, Adding to cart, Was, Now, You save, UK Shipping, RFD, Return Form, Restricted products",
              "- ceny w GBP/EUR/USD/PLN i separatory '* * *' / '---'",
              "nazwa: pełna nazwa produktu (marka + model + wariant), po polsku jeżeli źródło jest po polsku, w oryginale jeżeli po angielsku — bez nazwy sklepu. MUSI zaczynać się od marki/producenta, jeżeli je znasz.",
              "producent: pełna nazwa firmy-producenta (np. „Norma Precision AB\", „Federal Premium\"). Jeśli nie znasz pełnej — wpisz to samo co marka.",
              "marka: krótka nazwa marki widoczna na produkcie (np. „Norma\", „Federal\", „Sako\"). Sam ciąg, bez etykiet.",
              "kod: SKU sklepu (jeżeli widoczny). Sam ciąg, bez etykiet.",
              "kod_producenta: MPN / kod katalogowy PRODUCENTA (nie SKU sklepu). Szukaj w sekcjach „Kod producenta\", „Manufacturer part number\", „MPN\", „Art. Nr\", „Ref.\". Sam ciąg.",
              "ean: 8/12/13/14-cyfrowy kod EAN/GTIN/UPC jeżeli obecny. Sam ciąg cyfr, bez spacji, bez „EAN:\".",
              "product_description: opis produktu MAX 3000 znaków. MUSI być po polsku — jeżeli źródło jest po angielsku, PRZETŁUMACZ zachowując dosłownie nazwę, markę, model, wariant, kaliber, gramaturę, jednostki i oznaczenia techniczne. Bez nazw sklepów, cen, „kup teraz\", numerów telefonu, adresów e-mail, informacji o wysyłce.",
              "product_features: konkretne cechy techniczne klucz/wartość (np. Kaliber, Masa pocisku, Materiał, Wymiary, Pojemność, Kolor). Klucze po polsku.",
              "product_image_indexes: indeksy (1-based) WYŁĄCZNIE zdjęć tego produktu. Pomiń logo, ikony UI, banery, inne warianty, miniatury innych produktów.",
              "Jeżeli strona nie jest stroną produktu (np. kategoria, listing) — ustaw is_product_page=false i podaj powód w rejected_reason.",
              'Zwróć JSON: {"nazwa": string, "producent": string, "marka": string, "kod": string, "kod_producenta": string, "ean": string, "product_description": string, "product_features": [{"key": string, "value": string}], "product_image_indexes": number[], "is_product_page": boolean, "rejected_reason": string}.',
            ].join("\n");

            const user = [
              `STRONA: ${url}`,
              `TYTUŁ: ${pageTitle ?? ""}`,
              "",
              "PODPOWIEDZI Z JSON-LD (mogą być pomocne, ale nie ufaj bezkrytycznie):",
              `  name: ${hints.name}`,
              `  brand: ${hints.brand}`,
              `  mpn: ${hints.mpn}`,
              `  sku: ${hints.sku}`,
              `  gtin: ${hints.gtin}`,
              "",
              "MARKDOWN STRONY (skrócony):",
              focusedMd.slice(0, 6000),
              "",
              "KANDYDACI ZDJĘĆ (1-based):",
              cappedImages.map((u, i) => `${i + 1}. ${u}`).join("\n") || "(brak)",
            ].join("\n");

            try {
              const parsed = await callGatewayJson(aiKey, EXTRACT_MODEL, [
                { role: "system", content: system },
                { role: "user", content: user },
              ]);
              extracted = ExtractSchema.parse(parsed);
            } catch (e) {
              console.warn("importProductsFromUrls: AI extract failed, using JSON-LD fallback", url, e);
            }
          }

          if (!extracted.is_product_page && extracted.rejected_reason) {
            return { url, ok: false, error: `Strona nie jest produktem: ${extracted.rejected_reason}` };
          }

          // Enrich the product name with brand + manufacturer code so Google
          // discovery has strong, unambiguous keywords to work with.
          const nameCandidates = [
            extracted.nazwa.trim(),
            hints.name.trim(),
            pageTitle ?? "",
            h1Title,
          ];
          const rawNazwa =
            nameCandidates.find((c) => c && !isJunkName(c)) ?? "";
          const marka = (extracted.marka || extracted.producent || hints.brand || "").trim();
          const mpn = (extracted.kod_producenta || hints.mpn || "").trim();
          const lowerName = rawNazwa.toLowerCase();
          const parts: string[] = [];
          if (marka && !lowerName.includes(marka.toLowerCase())) parts.push(marka);
          parts.push(rawNazwa);
          if (mpn && !lowerName.includes(mpn.toLowerCase())) parts.push(mpn);
          const nazwa = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
          if (!nazwa || isJunkName(nazwa)) {
            const hint = !h1Title && !pageTitle
              ? "Strona nie zawiera nagłówka H1 ani <title> — sprawdź, czy link prowadzi do konkretnego produktu, a nie do listingu/kategorii."
              : "Nie udało się wykryć nazwy produktu (AI zwróciło pustą nazwę, brak JSON-LD Product).";
            return { url, ok: false, error: hint };
          }

          const imageUrls = filterImageUrls(
            extracted.product_image_indexes
              .map((i) => cappedImages[i - 1])
              .filter((u): u is string => typeof u === "string" && u.length > 0),
          );
          const description = sanitizeProductDescription(
            extracted.product_description || "",
          );

          // 1) source_products — one row per URL. RLS scopes writes to caller.
          const { data: spRow, error: spErr } = await supabase
            .from("source_products")
            .insert({
              project_id: data.projectId,
              ext_id: null,
              nazwa,
              kod:
                (extracted.kod_producenta.trim() ||
                  extracted.kod.trim() ||
                  hints.mpn.trim() ||
                  hints.sku.trim()) || null,
              ean: extracted.ean.trim() || null,
              raw: {
                imported_from_url: url,
                json_ld: jsonLd.length ? jsonLd[0] : null,
                page_title: pageTitle,
                imported_extract: {
                  description: description || null,
                  features: extracted.product_features,
                  images: imageUrls,
                  producent: extracted.producent.trim() || null,
                  marka: marka || null,
                  kod_producenta: mpn || null,
                  kod_sklepu: extracted.kod.trim() || null,
                  original_name: rawNazwa,
                  at: new Date().toISOString(),
                },
              } as never,
            } as never)
            .select("id")
            .single();
          if (spErr) throw new Error(spErr.message);
          const sourceProductId = (spRow as { id: string }).id;

          // 2) enrichments — PENDING/NO_MATCH so Match/Generate can act on it.
          const { error: enErr } = await supabase.from("enrichments").upsert(
            {
              source_product_id: sourceProductId,
              project_id: data.projectId,
              status: "PENDING",
              match_type: "NO_MATCH",
            } as never,
            { onConflict: "source_product_id", ignoreDuplicates: true },
          );
          if (enErr) throw new Error(enErr.message);

          // Do NOT insert product_sources / search_results for the imported
          // URL — the whole point of URL import is to seed a product that
          // then goes through normal Firecrawl discovery + matching. If we
          // pre-fill sources with the same URL, discovery's onlyMissing
          // filter skips the product and the user sees the pasted link as
          // the only source. Scraped snippet (description/features/images)
          // is stashed in source_products.raw so it can be inspected later.
          void description;
          void imageUrls;
          return { url, ok: true, sourceProductId, name: nazwa };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { url, ok: false, error: msg };
        }
      }),
    );

    return { results };
  });