import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { probeManySizes } from "./image-size.server";

const MODEL = "google/gemini-3-flash-preview";
const VISION_MODEL = "google/gemini-2.5-flash";

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
    description: z.string().min(1).max(20000),
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

    const systemPrompt = [
      "Jesteś ekspertem PIM. Twoim zadaniem jest stworzyć jeden, najlepszy 'Złoty Rekord' produktu na podstawie 1-3 źródeł internetowych.",
      "Twoja odpowiedź MUSI być poprawnym JSON-em o strukturze: {\"name\": string, \"description\": string, \"features\": [{\"key\": string, \"value\": string}]}.",
      "Pisz po polsku. Opis powinien być rzeczowy, dobrze sformatowany (akapity, listy specyfikacji jeśli sensowne), 200-1500 znaków.",
      "NIE wymyślaj danych technicznych których nie ma w źródłach. NIE umieszczaj URL-i, nazw sklepów ani fraz typu 'kup teraz', 'dostawa', 'gwarancja'.",
      "Jeśli źródła się różnią - syntetyzuj wiarygodne wspólne fakty.",
      "FEATURES: wyodrębnij listę cech technicznych (max 60). Klucze po polsku, krótkie (np. \"Kolor\", \"Materiał\", \"Waga\", \"Pojemność\"). Wartości konkretne, bez marketingu. NIE wymyślaj — pomiń cechy nieobecne w źródłach. Pomiń ceny, dostępność, nazwy sklepów. Jeśli brak danych do cech, zwróć \"features\": [].",
    ].join("\n");

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
      `Wygeneruj JSON {\"name\", \"description\", \"features\"}.`,
    ].join("\n");

    try {
      const out = await callGateway(apiKey, systemPrompt, userPrompt);
      const name = sanitize(out.name, blacklist);
      const description = sanitize(out.description, blacklist);
      const sanitizeStr = (s: string) => sanitize(s, blacklist) ?? s;
      const newFeatures = (out.features ?? [])
        .map((f) => ({ key: sanitizeStr(f.key), value: sanitizeStr(f.value) }))
        .filter((f) => f.key && f.value);
      const existingFeatures = ((enrichment as { golden_features?: unknown }).golden_features ?? []) as Array<{ key: string; value: string }>;
      const shouldWriteFeatures =
        newFeatures.length > 0 && (data.mode === "all" || !existingFeatures.length);

      const previous = enrichment.golden_name
        ? {
            name: enrichment.golden_name,
            description: enrichment.golden_description,
            at: enrichment.generated_at,
          }
        : null;

      const updatePayload: Record<string, unknown> = {
        status: "GENERATED",
        golden_name: name,
        golden_description: description,
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
      return { ok: true, name, description, features: shouldWriteFeatures ? newFeatures : existingFeatures };
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