import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { probeManySizes } from "./image-size.server";
import {
  slugifyPl,
  clampName,
  clampMetaDescription,
  dedupeKeywords,
  GOLDEN_SEO_SYSTEM_PROMPT,
  sanitizeGoldenDescriptionHtml,
  ALLEGRO_DESCRIPTION_SYSTEM_PROMPT,
  sanitizeAllegroDescriptionHtml,
} from "./seo";

const MODEL = "google/gemini-3-flash-preview";
const VISION_MODEL = "google/gemini-2.5-flash";
const SCORE_MODEL = "google/gemini-2.5-flash-lite";

/**
 * Post-process a generated text to strip white-label / blacklisted terms.
 * Replaces case-insensitive whole-word occurrences with empty string and
 * collapses extra whitespace.
 */
const sanitize = (text: string | null, blacklist: string[]): string | null => {
  if (!text) return text;
  let out = text;
  for (const raw of blacklist) {
    const term = raw.trim();
    if (!term) continue;
    const re = new RegExp(
      term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    out = out.replace(re, "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
};

const callGateway = async (apiKey: string, systemPrompt: string, userPrompt: string) => {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Model did not return valid JSON");
  }
  const schema = z.object({
    name: z.string().min(1).max(500),
    slug: z.string().max(120).optional().default(""),
    description: z.string().min(1).max(20000),
    meta_description: z.string().max(400).optional().default(""),
    seo_keywords: z.array(z.string().min(1).max(120)).max(12).optional().default([]),
    features: z
      .array(z.object({ key: z.string().min(1).max(200), value: z.string().min(1).max(2000) }))
      .max(60)
      .optional()
      .default([]),
  });
  return schema.parse(parsed);
};

const callGatewayRaw = async (
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: unknown }>,
): Promise<unknown> => {
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
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Model did not return valid JSON");
  }
};

export const generateGoldenRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      productId: z.string().uuid(),
      mode: z.enum(["all", "single"]).default("all"),
      singleUrl: z.string().url().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const { data: product, error: pErr } = await supabase
      .from("source_products")
      .select("id, project_id, nazwa, kod, ean, raw")
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

    const { data: project } = await supabase
      .from("projects")
      .select("custom_prompt, blacklist")
      .eq("id", product.project_id)
      .single();
    const customPrompt = project?.custom_prompt ?? "";
    const blacklist = (project?.blacklist as string[] | null) ?? [];

    const { data: enrichment } = await supabase
      .from("enrichments")
      .select("*")
      .eq("source_product_id", product.id)
      .maybeSingle();
    if (!enrichment) throw new Error("No enrichment record. Run matching first.");

    let urls = ((enrichment.picked_urls as string[] | null) ?? []).slice(0, 3);
    if (data.mode === "single" && data.singleUrl) urls = [data.singleUrl];
    if (!urls.length) throw new Error("No source URLs to enrich from.");

    const { data: srcs } = await supabase
      .from("product_sources")
      .select("url, title, description")
      .eq("project_id", product.project_id)
      .in("url", urls);

    const sourceBlocks = (srcs ?? [])
      .map((s, idx) => {
        const desc = (s.description ?? "").slice(0, 4000);
        return `### Źródło ${idx + 1}\nURL: ${s.url}\nTYTUŁ: ${s.title ?? ""}\nOPIS:\n${desc}`;
      })
      .join("\n\n---\n\n");

    const raw = (product.raw as Record<string, unknown> | null) ?? {};
    const extraProps =
      (raw.extraProperties as unknown) ||
      (raw.additionalProperties as unknown) ||
      (raw.extra_properties as unknown) ||
      (raw.additional_properties as unknown) ||
      null;

    const systemPrompt = GOLDEN_SEO_SYSTEM_PROMPT;

    const userPrompt = [
      `PRODUKT (z bazy klienta):`,
      `nazwa: ${product.nazwa ?? ""}`,
      `kod: ${product.kod ?? ""}`,
      `ean: ${product.ean ?? ""}`,
      "",
      `EXTRA PROPERTIES (z bazy klienta):`,
      extraProps ? JSON.stringify(extraProps).slice(0, 4000) : "(brak)",
      "",
      `DODATKOWE INSTRUKCJE KLIENTA:`,
      customPrompt || "(brak)",
      "",
      `ŹRÓDŁA:`,
      sourceBlocks || "(brak)",
      "",
      'Wygeneruj JSON {"name", "slug", "description", "meta_description", "seo_keywords", "features"} zgodnie z regułami SEO opisanymi w system prompt.',
    ].join("\n");

    try {
      const out = await callGateway(apiKey, systemPrompt, userPrompt);
      const sanitizeStr = (s: string) => sanitize(s, blacklist) ?? s;
      const rawName = sanitize(out.name, blacklist) ?? "";
      const name = clampName(rawName, 70);
      const rawDescription = sanitize(out.description, blacklist) ?? "";
      const metaDescription = clampMetaDescription(sanitizeStr(out.meta_description ?? ""), 160);
      const slugSource = (out.slug && out.slug.trim()) ? out.slug : name;
      const slug = slugifyPl(slugSource, 75);
      const seoKeywords = dedupeKeywords((out.seo_keywords ?? []).map(sanitizeStr));
      const newFeatures = (out.features ?? [])
        .map((f) => ({ key: sanitizeStr(f.key), value: sanitizeStr(f.value) }))
        .filter((f) => f.key && f.value);
      const existingFeatures = ((enrichment as { golden_features?: unknown }).golden_features ?? []) as Array<{ key: string; value: string }>;
      const shouldWriteFeatures =
        newFeatures.length > 0 && (data.mode === "all" || !existingFeatures.length);
      const description = sanitizeGoldenDescriptionHtml(rawDescription, {
        name,
        features: shouldWriteFeatures ? newFeatures : existingFeatures,
      });

      const prevRow = enrichment as typeof enrichment & {
        golden_slug?: string | null;
        golden_meta_description?: string | null;
        golden_seo_keywords?: unknown;
      };
      const previous = enrichment.golden_name
        ? {
            name: enrichment.golden_name,
            description: enrichment.golden_description,
            slug: prevRow.golden_slug ?? null,
            meta_description: prevRow.golden_meta_description ?? null,
            seo_keywords: prevRow.golden_seo_keywords ?? null,
            at: enrichment.generated_at,
          }
        : null;

      const updatePayload: Record<string, unknown> = {
        status: "GENERATED",
        golden_name: name,
        golden_description: description,
        golden_slug: slug || null,
        golden_meta_description: metaDescription || null,
        golden_seo_keywords: seoKeywords.length ? seoKeywords : null,
        model: MODEL,
        generated_at: new Date().toISOString(),
        error: null,
        previous: previous as never,
      };
      if (shouldWriteFeatures) updatePayload.golden_features = newFeatures;

      const { error } = await supabase
        .from("enrichments")
        .update(updatePayload as never)
        .eq("id", enrichment.id);
      if (error) throw new Error(error.message);
      return {
        ok: true,
        name,
        description,
        slug,
        metaDescription,
        seoKeywords,
        features: shouldWriteFeatures ? newFeatures : existingFeatures,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("enrichments")
        .update({ status: "FAILED", error: msg } as never)
        .eq("id", enrichment.id);
      throw new Error(msg);
    }
  });

const FeaturesSchema = z.object({
  features: z.array(z.object({ key: z.string().min(1).max(200), value: z.string().min(1).max(2000) })).max(60),
});

export const generateFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ productId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const { data: product, error: pErr } = await supabase
      .from("source_products")
      .select("id, project_id, nazwa, kod, ean, raw")
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

    const { data: project } = await supabase
      .from("projects")
      .select("blacklist")
      .eq("id", product.project_id)
      .single();
    const blacklist = (project?.blacklist as string[] | null) ?? [];

    const { data: enrichment } = await supabase
      .from("enrichments")
      .select("id, picked_urls")
      .eq("source_product_id", product.id)
      .maybeSingle();
    if (!enrichment) throw new Error("No enrichment record. Run matching first.");

    const urls = ((enrichment.picked_urls as string[] | null) ?? []).slice(0, 3);
    const { data: srcs } = urls.length
      ? await supabase
          .from("product_sources")
          .select("url, title, description")
          .eq("project_id", product.project_id)
          .in("url", urls)
      : { data: [] as Array<{ url: string; title: string | null; description: string | null }> };

    const raw = (product.raw as Record<string, unknown> | null) ?? {};
    const extraProps =
      (raw.extraProperties as unknown) ||
      (raw.additionalProperties as unknown) ||
      (raw.extra_properties as unknown) ||
      (raw.additional_properties as unknown) ||
      null;

    const sourceBlocks = (srcs ?? [])
      .map((s, idx) => {
        const desc = (s.description ?? "").slice(0, 3000);
        return `### Źródło ${idx + 1} (${s.url})\nTYTUŁ: ${s.title ?? ""}\nOPIS:\n${desc}`;
      })
      .join("\n\n---\n\n");

    const systemPrompt = [
      "Jesteś ekspertem PIM. Wyodrębnij listę cech technicznych produktu jako JSON.",
      "Odpowiedź MUSI być JSON-em: {\"features\": [{\"key\": string, \"value\": string}]}.",
      "Klucze po polsku, krótkie (np. \"Kolor\", \"Materiał\", \"Waga\", \"Pojemność\").",
      "Wartości konkretne, bez marketingu. NIE wymyślaj. Pomiń cechy nieobecne w źródłach.",
      "Pomiń ceny, dostępność, nazwy sklepów.",
    ].join("\n");

    const userPrompt = [
      `PRODUKT: ${product.nazwa ?? ""}`,
      `EAN: ${product.ean ?? ""} · Kod: ${product.kod ?? ""}`,
      "",
      `EXTRA PROPERTIES (z bazy klienta):`,
      extraProps ? JSON.stringify(extraProps).slice(0, 4000) : "(brak)",
      "",
      `ŹRÓDŁA:`,
      sourceBlocks || "(brak)",
      "",
      `Zwróć JSON {\"features\": [{\"key\", \"value\"}]}.`,
    ].join("\n");

    const parsed = await callGatewayRaw(apiKey, MODEL, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const out = FeaturesSchema.parse(parsed);

    const sanitizeStr = (s: string) => sanitize(s, blacklist) ?? s;
    const features = out.features.map((f) => ({ key: sanitizeStr(f.key), value: sanitizeStr(f.value) }));

    const { error } = await supabase
      .from("enrichments")
      .update({ golden_features: features } as never)
      .eq("id", enrichment.id);
    if (error) throw new Error(error.message);
    return { features };
  });

const VerifySchema = z.object({
  watermark_urls: z.array(z.string()).default([]),
  name_mismatch: z.boolean().default(false),
  feature_mismatches: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

const VerifySourcesSchema = z.object({
  watermark_urls: z.array(z.string()).default([]),
  mismatch_urls: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

export const verifySources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ productId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const { data: product, error: pErr } = await supabase
      .from("source_products")
      .select("id, project_id, nazwa, kod, ean")
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

    const { data: project } = await supabase
      .from("projects")
      .select("include_extra_images")
      .eq("id", product.project_id)
      .single();
    const includeExtra = (project as { include_extra_images?: boolean } | null)?.include_extra_images ?? false;

    const { data: enrichment } = await supabase
      .from("enrichments")
      .select("id, picked_urls, hidden_images, image_meta, quality")
      .eq("source_product_id", product.id)
      .maybeSingle();
    if (!enrichment) throw new Error("No enrichment record. Run matching first.");

    const picked = ((enrichment.picked_urls as string[] | null) ?? []);
    if (!picked.length) return { ok: true, hidden_added: 0, measured: 0 };

    const { data: srcs } = await supabase
      .from("product_sources")
      .select("url, images, extra_images")
      .eq("project_id", product.project_id)
      .in("url", picked);

    const allImages: string[] = [];
    for (const s of srcs ?? []) {
      const main = Array.isArray(s.images) ? (s.images as string[]) : [];
      const extra = includeExtra && Array.isArray((s as { extra_images?: unknown }).extra_images)
        ? ((s as { extra_images: string[] }).extra_images)
        : [];
      for (const u of [...main, ...extra]) if (!allImages.includes(u)) allImages.push(u);
    }
    if (!allImages.length) return { ok: true, hidden_added: 0, measured: 0 };

    // 1) Measure sizes for all images (cached in image_meta — skip already-known URLs)
    const existingMeta = ((enrichment as unknown as { image_meta?: Record<string, { w: number; h: number }> }).image_meta ?? {}) as Record<string, { w: number; h: number }>;
    const toMeasure = allImages.filter((u) => !existingMeta[u]);
    const fresh = toMeasure.length ? await probeManySizes(toMeasure, 6) : {};
    const image_meta = { ...existingMeta, ...fresh };

    // 2) Pick a small set (max 8) to send to the vision model — prefer big.
    const sortedForAI = [...allImages].sort((a, b) => {
      const am = image_meta[a]; const bm = image_meta[b];
      const aa = am ? am.w * am.h : 0;
      const bb = bm ? bm.w * bm.h : 0;
      return bb - aa;
    }).slice(0, 8);

    let watermark: string[] = [];
    let mismatch: string[] = [];
    let notes = "";
    try {
      const systemPrompt = [
        "Jesteś asystentem QA katalogu produktów. Otrzymasz nazwę produktu (+EAN/kod) i URL-e zdjęć ze źródeł.",
        "Zwróć URL-e zdjęć, które:",
        "  (a) mają widoczny znak wodny / logo sklepu / napis 'kup teraz' itp. (watermark_urls),",
        "  (b) wyraźnie NIE przedstawiają tego produktu (mismatch_urls).",
        "Bądź zachowawczy — w razie wątpliwości NIE zgłaszaj URL-a.",
        "Odpowiedź MUSI być JSON-em: {\"watermark_urls\": string[], \"mismatch_urls\": string[], \"notes\": string}.",
      ].join("\n");
      const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
          type: "text",
          text: [
            `PRODUKT: ${product.nazwa ?? ""}`,
            `EAN: ${product.ean ?? ""} · Kod: ${product.kod ?? ""}`,
            "URL-e (w kolejności do oceny):",
            sortedForAI.map((u, i) => `${i + 1}. ${u}`).join("\n"),
          ].join("\n"),
        },
        ...sortedForAI.map((u) => ({ type: "image_url" as const, image_url: { url: u } })),
      ];
      const parsed = await callGatewayRaw(apiKey, VISION_MODEL, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ]);
      const out = VerifySourcesSchema.parse(parsed);
      watermark = out.watermark_urls.filter((u) => sortedForAI.includes(u));
      mismatch = out.mismatch_urls.filter((u) => sortedForAI.includes(u));
      notes = out.notes;
    } catch (e) {
      notes = `verify failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 3) Merge into hidden_images (dedup). Size filter happens at read time
    //    (so the "only image" fallback can keep a small image when there is
    //    truly nothing else).
    const prevHidden = ((enrichment as { hidden_images?: string[] }).hidden_images ?? []) as string[];
    const hiddenSet = new Set(prevHidden);
    for (const u of [...watermark, ...mismatch]) hiddenSet.add(u);
    const newHidden = Array.from(hiddenSet);

    const prevQuality = ((enrichment as { quality?: Record<string, unknown> }).quality ?? {}) as Record<string, unknown>;
    const quality = {
      ...prevQuality,
      pre_verify: {
        watermark_urls: watermark,
        mismatch_urls: mismatch,
        notes,
        evaluated_urls: sortedForAI,
        at: new Date().toISOString(),
      },
    };

    const { error: upErr } = await supabase
      .from("enrichments")
      .update({
        hidden_images: newHidden as never,
        image_meta: image_meta as never,
        quality: quality as never,
      } as never)
      .eq("id", enrichment.id);
    if (upErr) throw new Error(upErr.message);

    return {
      ok: true,
      hidden_added: newHidden.length - prevHidden.length,
      measured: Object.keys(fresh).length,
      watermark_count: watermark.length,
      mismatch_count: mismatch.length,
    };
  });

export const verifyProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ productId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const { data: product, error: pErr } = await supabase
      .from("source_products")
      .select("id, project_id, nazwa")
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

    const { data: project } = await supabase
      .from("projects")
      .select("include_extra_images")
      .eq("id", product.project_id)
      .single();
    const includeExtra = (project as { include_extra_images?: boolean } | null)?.include_extra_images ?? false;

    const { data: enrichment } = await supabase
      .from("enrichments")
      .select("id, picked_urls, golden_name, golden_features, hidden_images")
      .eq("source_product_id", product.id)
      .maybeSingle();
    if (!enrichment) throw new Error("No enrichment record. Run matching first.");

    const picked = ((enrichment.picked_urls as string[] | null) ?? []).slice(0, 3);
    const hidden = new Set(((enrichment as { hidden_images?: string[] }).hidden_images ?? []));
    let images: string[] = [];
    if (picked.length) {
      const { data: srcs } = await supabase
        .from("product_sources")
        .select("url, images, extra_images")
        .eq("project_id", product.project_id)
        .in("url", picked);
      for (const s of srcs ?? []) {
        const main = Array.isArray(s.images) ? (s.images as string[]) : [];
        const extra = includeExtra && Array.isArray((s as { extra_images?: unknown }).extra_images)
          ? ((s as { extra_images: string[] }).extra_images)
          : [];
        for (const u of [...main, ...extra]) {
          if (!hidden.has(u) && !images.includes(u)) images.push(u);
        }
      }
    }
    images = images.slice(0, 6);

    const name = (enrichment as { golden_name?: string | null }).golden_name ?? product.nazwa ?? "";
    const features = ((enrichment as unknown as { golden_features?: Array<{ key: string; value: string }> }).golden_features ?? []);

    const systemPrompt = [
      "Jesteś asystentem kontroli jakości katalogu produktów.",
      "Otrzymasz nazwę produktu, listę cech i URL-e zdjęć.",
      "Sprawdź: (1) czy zdjęcia mają znak wodny / logo sklepu / watermark (zwróć ich URL),",
      "(2) czy zdjęcia pasują do nazwy produktu (name_mismatch=true gdy NIE),",
      "(3) które cechy są sprzeczne / nieprawdopodobne dla tego produktu (lista stringów).",
      "Odpowiedź MUSI być JSON-em: {\"watermark_urls\": string[], \"name_mismatch\": boolean, \"feature_mismatches\": string[], \"notes\": string}.",
      "Po polsku, krótko, rzeczowo.",
    ].join("\n");

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      {
        type: "text",
        text: [
          `NAZWA: ${name}`,
          `CECHY: ${features.length ? features.map((f) => `${f.key}: ${f.value}`).join(" | ") : "(brak)"}`,
          `URL-e zdjęć (do podglądu): ${images.join(" , ") || "(brak)"}`,
          "",
          "Zwróć JSON wg schematu.",
        ].join("\n"),
      },
      ...images.map((u) => ({ type: "image_url" as const, image_url: { url: u } })),
    ];

    const parsed = await callGatewayRaw(apiKey, VISION_MODEL, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);
    const out = VerifySchema.parse(parsed);

    const { error } = await supabase
      .from("enrichments")
      .update({ quality: out as never } as never)
      .eq("id", enrichment.id);
    if (error) throw new Error(error.message);
    return out;
  });

const ImageScoreSchema = z.object({
  is_central: z.number().min(0).max(10),
  is_clean: z.number().min(0).max(10),
  has_packaging: z.number().min(0).max(10),
  is_banner_or_trash: z.boolean(),
});
export type ImageScore = z.infer<typeof ImageScoreSchema> & { scored_at: string };

const SCORE_SYSTEM_PROMPT =
  "Jesteś ekspertem e-commerce. Oceń kompozycję zdjęcia pod kątem przydatności jako główna miniaturka produktu w sklepie. Zwróć surowy JSON według podanego schematu.";

const SCORE_USER_TEXT = [
  "Oceń to zdjęcie produktu i zwróć WYŁĄCZNIE JSON o strukturze:",
  '{"is_central": number (1-10), "is_clean": number (1-10), "has_packaging": number (0-10), "is_banner_or_trash": boolean}',
  "",
  "is_central: czy produkt jest na środku kadru, dobrze widoczny (10), czy mikro-produkt w rogu / ucięty (1).",
  "is_clean: czy tło jest jednolite/białe/mało rozpraszające (10). Odejmij punkty za banery, napisy, logotypy, kolaż.",
  "has_packaging: 10 = w jednym kadrze widać i opakowanie/pudełko I sam produkt (np. pudełko amunicji + naboje obok); 6-9 = widać tylko pudełko/opakowanie z grafiką produktu; 3-5 = tylko sam produkt bez opakowania; 0-2 = brak kontekstu produktu / nieczytelne.",
  "is_banner_or_trash: true, jeśli obrazek to baner reklamowy, infografika, tabela rozmiarów, ikona, logo sklepu, znak wodny lub kolaż - czyli NIE nadaje się na miniaturę.",
].join("\n");

async function scoreOneImage(apiKey: string, url: string, timeoutMs = 15000): Promise<ImageScore> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: SCORE_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SCORE_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: SCORE_USER_TEXT },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
    });
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
    if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new Error("Model did not return valid JSON"); }
    const out = ImageScoreSchema.parse(parsed);
    return { ...out, scored_at: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}

export const analyzeProductImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      productId: z.string().uuid(),
      urls: z.array(z.string().url()).min(1).max(8),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const { data: enrichment, error: eErr } = await supabase
      .from("enrichments")
      .select("id, image_scores")
      .eq("source_product_id", data.productId)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!enrichment) throw new Error("No enrichment record. Run matching first.");

    const existing = (((enrichment as unknown as { image_scores?: Record<string, ImageScore> }).image_scores) ?? {}) as Record<string, ImageScore>;
    const toScore = data.urls.filter((u) => !existing[u]);

    if (!toScore.length) {
      return { scores: existing, source: "cache" as const, failed: [] as string[] };
    }

    const settled = await Promise.allSettled(toScore.map((u) => scoreOneImage(apiKey, u)));
    const merged: Record<string, ImageScore> = { ...existing };
    const failed: string[] = [];
    settled.forEach((r, idx) => {
      const url = toScore[idx];
      if (r.status === "fulfilled") merged[url] = r.value;
      else failed.push(url);
    });

    const anySuccess = settled.some((r) => r.status === "fulfilled");
    if (anySuccess) {
      const { error: upErr } = await supabase
        .from("enrichments")
        .update({ image_scores: merged as never } as never)
        .eq("id", enrichment.id);
      if (upErr) throw new Error(upErr.message);
    }

    const allFailed = failed.length === toScore.length;
    if (allFailed) throw new Error("AI scoring failed for all images");

    return {
      scores: merged,
      source: (failed.length ? "partial" : "ai") as "partial" | "ai",
      failed,
    };
  });

// ---------------------------------------------------------------------------
// Visualization field suggestions (Styl / Wymagania) based on project name.
// ---------------------------------------------------------------------------

const SuggestVizInput = z.object({
  projectId: z.string().uuid(),
  field: z.enum(["style", "requirements"]),
});

export const suggestVisualizationField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SuggestVizInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: proj, error } = await supabase
      .from("projects")
      .select("name, visualization_style_prompt, visualization_requirements_pl")
      .eq("id", data.projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proj) throw new Error("Nie znaleziono projektu");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const projectName = (proj.name ?? "").trim() || "(bez nazwy)";
    const currentStyle = (proj.visualization_style_prompt ?? "").trim();

    const system =
      data.field === "style"
        ? [
            "Jesteś dyrektorem artystycznym fotografii produktowej e-commerce.",
            "Na podstawie NAZWY PROJEKTU (kategoria / typ asortymentu) zaproponuj po polsku styl i scenę dla wizualizacji lifestyle produktów z tego projektu.",
            "Wymogi:",
            "- 1–2 zdania, maks. 220 znaków.",
            "- Konkretne otoczenie, powierzchnia/tło, pora dnia, charakter światła, nastrój.",
            "- Bez marek, bez ludzi z twarzą, bez cen, bez CTA.",
            "- Zwróć wyłącznie treść propozycji (czysty tekst, bez nagłówków, bez cudzysłowów).",
          ].join("\n")
        : [
            "Jesteś fotografem produktowym. Na podstawie NAZWY PROJEKTU (kategoria / typ asortymentu) wypisz po polsku wymagania techniczne dla wizualizacji lifestyle.",
            "Wymogi:",
            "- 3–5 krótkich punktów oddzielonych przecinkami lub myślnikami (nie lista markdown), maks. 320 znaków łącznie.",
            "- Uwzględnij: kąt kamery, głębię ostrości, kierunek i temperaturę światła, kompozycję/tło, obecność rekwizytów.",
            "- Nie zmieniaj koloru, logo ani proporcji produktu — to zasada domyślna.",
            "- Zwróć wyłącznie treść propozycji (czysty tekst, bez nagłówków, bez cudzysłowów).",
          ].join("\n");

    const user =
      data.field === "style"
        ? `Nazwa projektu: "${projectName}".`
        : `Nazwa projektu: "${projectName}".${currentStyle ? `\nWybrany styl/scena: "${currentStyle}".` : ""}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "openai/gpt-5.5",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (res.status === 429) throw new Error("Przekroczono limit zapytań AI — spróbuj za chwilę.");
    if (res.status === 402) throw new Error("Brak kredytów AI w workspace.");
    if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = (json.choices?.[0]?.message?.content ?? "").trim().replace(/^["„"]|["""]$/g, "");
    if (!text) throw new Error("Model nie zwrócił treści");
    return { text };
  });