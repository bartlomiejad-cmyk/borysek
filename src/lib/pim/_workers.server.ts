/**
 * Server-only helpers used by the background bulk-job worker (and only there).
 *
 * Mirrors the logic of the user-facing serverFns (`verifySources`,
 * `generateGoldenRecord`, `regenerateMedia`) but operates with `supabaseAdmin`
 * because the cron-driven worker has no end-user JWT. Ownership is verified at
 * job creation time via RLS on `bulk_jobs`.
 *
 * Kept deliberately self-contained to avoid touching working serverFns.
 */
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { probeManySizes } from "./image-size.server";
import { isMarketplaceUrl } from "./firecrawl.functions";
import { filterImageUrls, sanitizeProductDescription } from "./source-cleanup";
import Firecrawl from "@mendable/firecrawl-js";

const GOLDEN_MODEL = "google/gemini-3-flash-preview";
const VISION_MODEL = "google/gemini-2.5-flash";
const CLASSIFY_MODEL = "google/gemini-2.5-flash";
const FAL_BASE = "https://fal.run";

// ---------------------------------------------------------------------------
// Bulk-job event callback — used by the queue runner to stream live progress
// into `bulk_job_events` (subscribed to from the UI). Workers call it for
// human-readable milestones; runner attaches job/project/product IDs.
// ---------------------------------------------------------------------------

export type JobEvent = {
  level: "info" | "success" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
};

export type WorkerCtx = {
  onEvent?: (e: JobEvent) => void | Promise<void>;
};

async function emit(ctx: WorkerCtx | undefined, e: JobEvent): Promise<void> {
  if (!ctx?.onEvent) return;
  try {
    await ctx.onEvent(e);
  } catch {
    /* never let logging break the worker */
  }
}

// ---------------------------------------------------------------------------
// Generic AI gateway helpers
// ---------------------------------------------------------------------------

const GoldenSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().min(1).max(20000),
  features: z
    .array(z.object({ key: z.string().min(1).max(200), value: z.string().min(1).max(2000) }))
    .max(60)
    .optional()
    .default([]),
});

const VerifySourcesSchema = z.object({
  watermark_urls: z.array(z.string()).default([]),
  mismatch_urls: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

async function callGatewayJson(apiKey: string, model: string, messages: unknown[]): Promise<unknown> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, messages }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text().catch(() => "")}`);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = j.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
}

function sanitize(text: string | null, blacklist: string[]): string | null {
  if (!text) return text;
  let out = text;
  for (const raw of blacklist) {
    const term = raw.trim();
    if (!term) continue;
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// FAL helpers (shared with media regen)
// ---------------------------------------------------------------------------

type FalImage = { url: string };
type FalResp = { images?: FalImage[]; image?: FalImage };

function encodeImageUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.pathname = u.pathname
      .split("/")
      .map((seg) => {
        if (!seg) return seg;
        let decoded = seg;
        try { decoded = decodeURIComponent(seg); } catch { decoded = seg; }
        return encodeURIComponent(decoded);
      })
      .join("/");
    return u.toString();
  } catch {
    return raw;
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const safe = encodeImageUrl(url);
  const res = await fetch(safe, {
    headers: { Accept: "image/*,*/*;q=0.8", "User-Agent": "Mozilla/5.0 (compatible; LovableProductImageBot/1.0)" },
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function callFal(path: string, body: unknown, apiKey: string): Promise<FalResp> {
  const res = await fetch(`${FAL_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("FAL: nieprawidłowy klucz API");
  if (res.status === 402) throw new Error("FAL: brak kredytów");
  if (res.status === 429) throw new Error("FAL: limit zapytań");
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`FAL ${path} ${res.status}: ${txt.slice(0, 300)}`);
  }
  return (await res.json()) as FalResp;
}

async function prepareFalSource(enrichmentId: string, srcUrl: string): Promise<{ url: string; path: string }> {
  const bytes = await fetchBytes(srcUrl);
  const path = `fal-sources/${enrichmentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from("regenerated-images")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Prepare FAL source: ${error.message}`);
  const { data: pub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(path);
  return { url: pub.publicUrl, path };
}

// ---------------------------------------------------------------------------
// Run: verify sources (watermark/mismatch + measure sizes)
// ---------------------------------------------------------------------------

export async function runVerifySources(productId: string): Promise<void> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const { data: product } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, kod, ean")
    .eq("id", productId)
    .single();
  if (!product) throw new Error("Product not found");

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("include_extra_images")
    .eq("id", product.project_id)
    .single();
  const includeExtra = (project as { include_extra_images?: boolean } | null)?.include_extra_images ?? false;

  const { data: enrichment } = await supabaseAdmin
    .from("enrichments")
    .select("id, picked_urls, hidden_images, image_meta, quality")
    .eq("source_product_id", product.id)
    .maybeSingle();
  if (!enrichment) return;

  const picked = ((enrichment.picked_urls as string[] | null) ?? []);
  if (!picked.length) return;

  const { data: srcs } = await supabaseAdmin
    .from("product_sources")
    .select("url, images, extra_images")
    .eq("project_id", product.project_id)
    .in("url", picked);

  const allImages: string[] = [];
  for (const s of srcs ?? []) {
    const main = Array.isArray(s.images) ? (s.images as string[]) : [];
    const extra = includeExtra && Array.isArray((s as { extra_images?: unknown }).extra_images)
      ? ((s as { extra_images: string[] }))
      : [];
    for (const u of [...main, ...(extra as string[])]) if (!allImages.includes(u)) allImages.push(u);
  }
  if (!allImages.length) return;

  const existingMeta = ((enrichment as unknown as { image_meta?: Record<string, { w: number; h: number }> }).image_meta ?? {}) as Record<string, { w: number; h: number }>;
  const toMeasure = allImages.filter((u) => !existingMeta[u]);
  const fresh = toMeasure.length ? await probeManySizes(toMeasure, 6) : {};
  const image_meta = { ...existingMeta, ...fresh };

  const sortedForAI = [...allImages].sort((a, b) => {
    const am = image_meta[a]; const bm = image_meta[b];
    return (bm ? bm.w * bm.h : 0) - (am ? am.w * am.h : 0);
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
      'Odpowiedź MUSI być JSON-em: {"watermark_urls": string[], "mismatch_urls": string[], "notes": string}.',
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
    const parsed = await callGatewayJson(apiKey, VISION_MODEL, [
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

  const prevHidden = ((enrichment as { hidden_images?: string[] }).hidden_images ?? []) as string[];
  const hiddenSet = new Set(prevHidden);
  for (const u of [...watermark, ...mismatch]) hiddenSet.add(u);

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

  await supabaseAdmin
    .from("enrichments")
    .update({
      hidden_images: Array.from(hiddenSet) as never,
      image_meta: image_meta as never,
      quality: quality as never,
    } as never)
    .eq("id", enrichment.id);
}

// ---------------------------------------------------------------------------
// Run: generate golden record
// ---------------------------------------------------------------------------

export async function runGenerateGoldenRecord(productId: string, mode: "all" | "single" = "all", ctx?: WorkerCtx): Promise<void> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const { data: product, error: pErr } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, kod, ean, raw")
    .eq("id", productId)
    .single();
  if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");
  await emit(ctx, { level: "info", message: `✍️  ${product.nazwa ?? productId} — generuję opis` });

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("custom_prompt, blacklist")
    .eq("id", product.project_id)
    .single();
  const customPrompt = project?.custom_prompt ?? "";
  const blacklist = (project?.blacklist as string[] | null) ?? [];

  const { data: enrichment } = await supabaseAdmin
    .from("enrichments")
    .select("*")
    .eq("source_product_id", product.id)
    .maybeSingle();
  if (!enrichment) throw new Error("No enrichment record. Run matching first.");

  const urls = ((enrichment.picked_urls as string[] | null) ?? []).slice(0, 3);
  if (!urls.length) throw new Error("No source URLs to enrich from.");

  const { data: srcs } = await supabaseAdmin
    .from("product_sources")
    .select("url, title, description")
    .eq("project_id", product.project_id)
    .in("url", urls);

  const sourceBlocks = (srcs ?? [])
    .map((s, idx) => {
      const desc = sanitizeProductDescription(s.description ?? "").slice(0, 4000);
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
    "Jesteś redaktorem katalogu produktów. Tworzysz jeden zwięzły, naturalny opis produktu na podstawie 1-3 źródeł internetowych.",
    'Odpowiedź MUSI być poprawnym JSON-em: {"name": string, "description": string, "features": [{"key": string, "value": string}]}.',
    "Pisz po polsku, neutralnym językiem katalogowym. Konkret zamiast emocji.",
    "OPIS: 350-900 znaków. Pierwsze zdanie mówi czym produkt jest i do czego służy. Kolejne zdania podają najważniejsze fakty (materiał, wymiary, sposób działania, najważniejsze funkcje) wyłącznie na podstawie źródeł.",
    "ZAKAZANE: marketingowe ogólniki i fraza-klisze typu: 'idealny wybór', 'doskonały', 'wyjątkowy', 'zaprojektowany z myślą', 'sprawdzi się w każdej sytuacji', 'najwyższa jakość', 'rewolucyjny', 'niezastąpiony', 'spełni oczekiwania', 'cieszy oko', 'gwarantuje', wykrzykniki, drugiej osoby ('Twój', 'Ciebie').",
    "ZAKAZANE: ceny, dostępność, dostawa, gwarancja, nazwy sklepów, URL-e, frazy typu 'kup teraz'.",
    "Nie powtarzaj nazwy produktu więcej niż raz. Nie zaczynaj od 'Przedstawiamy', 'Poznaj', 'Odkryj'. Bez nagłówków, bez list w opisie.",
    "Jeśli źródła się różnią — wybierz wspólny, wiarygodny zbiór faktów. Jeśli czegoś nie ma w źródłach, pomiń to.",
    'FEATURES: lista konkretnych cech technicznych (max 60). Klucze po polsku, krótkie (np. "Materiał", "Wymiary", "Pojemność", "Kolor"). Wartości konkretne, bez przymiotników marketingowych. Pomiń cechy nieobecne w źródłach. Pomiń ceny, dostępność, nazwy sklepów. Jeśli brak danych: "features": [].',
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
    'Wygeneruj JSON {"name", "description", "features"}.',
  ].join("\n");

  try {
    const parsed = await callGatewayJson(apiKey, GOLDEN_MODEL, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const out = GoldenSchema.parse(parsed);
    const name = sanitize(out.name, blacklist);
    const description = sanitizeProductDescription(sanitize(out.description, blacklist) ?? "");
    const sanitizeStr = (s: string) => sanitize(s, blacklist) ?? s;
    const newFeatures = (out.features ?? [])
      .map((f) => ({ key: sanitizeStr(f.key), value: sanitizeStr(f.value) }))
      .filter((f) => f.key && f.value);
    const existingFeatures = ((enrichment as { golden_features?: unknown }).golden_features ?? []) as Array<{ key: string; value: string }>;
    const shouldWriteFeatures = newFeatures.length > 0 && (mode === "all" || !existingFeatures.length);

    const previous = enrichment.golden_name
      ? { name: enrichment.golden_name, description: enrichment.golden_description, at: enrichment.generated_at }
      : null;

    const updatePayload: Record<string, unknown> = {
      status: "GENERATED",
      golden_name: name,
      golden_description: description,
      model: GOLDEN_MODEL,
      generated_at: new Date().toISOString(),
      error: null,
      previous: previous as never,
    };
    if (shouldWriteFeatures) updatePayload.golden_features = newFeatures;

    const { error } = await supabaseAdmin
      .from("enrichments")
      .update(updatePayload as never)
      .eq("id", enrichment.id);
    if (error) throw new Error(error.message);
    await emit(ctx, { level: "success", message: `✅ ${product.nazwa ?? productId} — opis wygenerowany` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("enrichments")
      .update({ status: "FAILED", error: msg } as never)
      .eq("id", enrichment.id);
    await emit(ctx, { level: "error", message: `❌ ${product.nazwa ?? productId} — ${msg}` });
    throw new Error(msg);
  }
}

// ---------------------------------------------------------------------------
// Run: regenerate media (main + gallery via FAL Seedream)
// ---------------------------------------------------------------------------

type Classification = { has_a: boolean; has_b: boolean; is_trash: boolean; scored_at: string };

type MediaSettings = {
  component_a: string;
  component_b: string | null;
  main_image_rule: "ONLY_A" | "A_AND_B_EXISTING" | "COMPOSITE_A_AND_B";
  target_resolution: number;
  padding_percent: number;
  max_gallery_images: number;
  apply_shadow: boolean;
  custom_style_prompt: string | null;
};

const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  component_a: "",
  component_b: null,
  main_image_rule: "ONLY_A",
  target_resolution: 2560,
  padding_percent: 70,
  max_gallery_images: 5,
  apply_shadow: true,
  custom_style_prompt: null,
};

async function loadMediaSettings(projectId: string): Promise<MediaSettings> {
  const { data: row } = await supabaseAdmin
    .from("media_technical_settings" as never)
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row) return { ...DEFAULT_MEDIA_SETTINGS };
  const r = row as unknown as MediaSettings;
  return {
    component_a: r.component_a ?? "",
    component_b: r.component_b ?? null,
    main_image_rule: r.main_image_rule ?? "ONLY_A",
    target_resolution: r.target_resolution ?? 2560,
    padding_percent: r.padding_percent ?? 70,
    max_gallery_images: r.max_gallery_images ?? 5,
    apply_shadow: r.apply_shadow ?? true,
    custom_style_prompt: r.custom_style_prompt ?? null,
  };
}

async function collectScrapedUrls(projectId: string, pickedUrls: string[], includeExtra: boolean): Promise<string[]> {
  if (!pickedUrls.length) return [];
  const { data: srcs } = await supabaseAdmin
    .from("product_sources")
    .select("url, images, extra_images")
    .eq("project_id", projectId)
    .in("url", pickedUrls);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of srcs ?? []) {
    const main = Array.isArray(s.images) ? (s.images as string[]) : [];
    const extra = includeExtra && Array.isArray((s as { extra_images?: unknown }).extra_images)
      ? ((s as { extra_images: string[] }).extra_images)
      : [];
    for (const u of filterImageUrls([...main, ...extra])) {
      if (!seen.has(u)) { seen.add(u); out.push(u); }
    }
  }
  return out;
}

async function classifyOneImage(apiKey: string, url: string, a: string, b: string | null, timeoutMs = 15000): Promise<Classification> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sys = "Jesteś ekspertem klasyfikacji zdjęć produktowych. Zwracasz wyłącznie surowy JSON.";
    const user = [
      `Komponent A = "${a}".`,
      `Komponent B = ${b ? `"${b}"` : "BRAK"}.`,
      "",
      'Zwróć JSON: {"has_a": bool, "has_b": bool, "is_trash": bool}.',
      "",
      "has_a: true jeśli zdjęcie wyraźnie pokazuje Komponent A.",
      "has_b: true jeśli zdjęcie wyraźnie pokazuje Komponent B. Gdy B = BRAK, zawsze false.",
      "is_trash: true jeśli zdjęcie to baner reklamowy, infografika, tabela rozmiarów, ikona, sam tekst, logo sklepu, kolaż.",
      "Watermarki/loga sklepu na zdjęciu w wysokiej rozdzielczości → NIE oznaczaj jako trash.",
      "W razie wątpliwości: has_a=false, has_b=false, is_trash=false.",
    ].join("\n");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "raw" },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: [{ type: "text", text: user }, { type: "image_url", image_url: { url } }] },
        ],
      }),
    });
    if (!res.ok) throw new Error(`classify ${res.status}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { has_a?: boolean; has_b?: boolean; is_trash?: boolean };
    return {
      has_a: !!parsed.has_a,
      has_b: !!parsed.has_b && !!b,
      is_trash: !!parsed.is_trash,
      scored_at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(t);
  }
}

async function classifyBatch(apiKey: string, urls: string[], a: string, b: string | null): Promise<Record<string, Classification>> {
  const out: Record<string, Classification> = {};
  let idx = 0;
  const worker = async () => {
    while (idx < urls.length) {
      const myIdx = idx++;
      const u = urls[myIdx];
      try {
        out[u] = await classifyOneImage(apiKey, u, a, b);
      } catch {
        out[u] = { has_a: false, has_b: false, is_trash: false, scored_at: new Date().toISOString() };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, Math.max(1, urls.length)) }, worker));
  return out;
}

function buildSeedreamPrompt(opts: {
  isComposite: boolean;
  componentA: string;
  componentB: string | null;
  paddingPercent: number;
  applyShadow: boolean;
  customStyle: string | null;
}): string {
  const fill = Math.max(30, Math.min(95, opts.paddingPercent));
  const lines: string[] = [];
  lines.push(`CRITICAL BACKGROUND: The background MUST be PURE WHITE #FFFFFF — no cream, beige, ivory, gray, gradient, vignette, paper texture. All four corners must be exactly #FFFFFF. If in doubt, make the background BRIGHTER and WHITER.`);
  if (opts.isComposite && opts.componentB) {
    lines.push(`COMPOSITION: Place "${opts.componentB}" naturally beside "${opts.componentA}" in one frame. Both elements in sharp focus, realistic relative scale.`);
  } else {
    lines.push(`SUBJECT: Move the exact same product ("${opts.componentA}") onto a clean pure white #FFFFFF seamless studio background.`);
  }
  lines.push(`FRAMING: Scale the product UP so it fills ${fill}% of the frame in BOTH width and height. Center it.`);
  lines.push(opts.applyShadow
    ? `SHADOW: Add a soft realistic contact shadow directly under the product only.`
    : `SHADOW: No shadow. Product floats cleanly on pure white.`);
  lines.push(`PRESERVE: Keep every printed label, logo, brand name, illustration, color, material and proportions exactly as in the source.`);
  lines.push(`WATERMARK REMOVAL: Remove watermarks, store logos, website URLs, photo credits, shop names and semi-transparent overlay text that are NOT physically printed on the product packaging itself.`);
  if (opts.customStyle && opts.customStyle.trim()) lines.push(`STYLE: ${opts.customStyle.trim()}`);
  lines.push(`AVOID: cream/beige/ivory/warm/gray background, tint, vignette, paper texture, tiny product, off-center, blurred text, regenerated artwork, missing labels, visible watermarks.`);
  return lines.join(" ");
}

export async function runRegenerateMedia(productId: string, ctx?: WorkerCtx): Promise<void> {
  const FAL_KEY = process.env.FAL_KEY;
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!FAL_KEY) throw new Error("FAL_KEY nie jest skonfigurowany");
  if (!apiKey) throw new Error("LOVABLE_API_KEY nie jest skonfigurowany");
  await emit(ctx, { level: "info", message: `🖼  Regeneruję media dla produktu ${productId.slice(0, 8)}…` });

  const { data: product } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id")
    .eq("id", productId)
    .single();
  if (!product) throw new Error("Product not found");

  const settings = await loadMediaSettings(product.project_id);
  if (!settings.component_a.trim()) throw new Error("Skonfiguruj Komponent A w ustawieniach AI");

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("include_extra_images")
    .eq("id", product.project_id)
    .single();
  const includeExtra = (project as { include_extra_images?: boolean } | null)?.include_extra_images ?? false;

  const { data: enrichment } = await supabaseAdmin
    .from("enrichments")
    .select("id, picked_urls, image_meta, image_scores, media_classification, ai_gallery_urls")
    .eq("source_product_id", product.id)
    .maybeSingle();
  if (!enrichment) throw new Error("Brak enrichment");

  const urls = await collectScrapedUrls(product.project_id, (enrichment.picked_urls as string[] | null) ?? [], includeExtra);
  if (!urls.length) throw new Error("Brak zdjęć źródłowych");

  const cached = (((enrichment as unknown as { media_classification?: Record<string, Classification> }).media_classification) ?? {});
  const toClassify = urls.filter((u) => !cached[u]);
  const fresh = toClassify.length ? await classifyBatch(apiKey, toClassify, settings.component_a, settings.component_b) : {};
  const classification: Record<string, Classification> = { ...cached, ...fresh };
  if (Object.keys(fresh).length) {
    await supabaseAdmin
      .from("enrichments")
      .update({ media_classification: classification as never } as never)
      .eq("id", enrichment.id);
  }

  const meta = ((enrichment as unknown as { image_meta?: Record<string, { w: number; h: number }> }).image_meta) ?? {};
  const score = (u: string) => { const m = meta[u]; return m ? m.w * m.h : 0; };

  const valid = urls.filter((u) => !classification[u]?.is_trash);
  const withA = valid.filter((u) => classification[u]?.has_a).sort((a, b) => score(b) - score(a));
  const withAB = valid.filter((u) => classification[u]?.has_a && classification[u]?.has_b).sort((a, b) => score(b) - score(a));
  const onlyB = valid.filter((u) => classification[u]?.has_b && !classification[u]?.has_a).sort((a, b) => score(b) - score(a));

  let mainSourceUrls: string[] = [];
  if (settings.main_image_rule === "ONLY_A") mainSourceUrls = withA.slice(0, 1);
  else if (settings.main_image_rule === "A_AND_B_EXISTING") mainSourceUrls = (withAB[0] ? [withAB[0]] : withA.slice(0, 1));
  else {
    if (withAB[0]) mainSourceUrls = [withAB[0]];
    else if (withA[0] && onlyB[0]) mainSourceUrls = [withA[0], onlyB[0]];
    else if (withA[0]) mainSourceUrls = [withA[0]];
  }
  if (!mainSourceUrls.length && valid[0]) mainSourceUrls = [valid[0]];
  if (!mainSourceUrls.length) throw new Error("Nie znaleziono zdjęcia z Komponentem A");

  const mainPrompt = buildSeedreamPrompt({
    isComposite: mainSourceUrls.length === 2,
    componentA: settings.component_a,
    componentB: settings.component_b,
    paddingPercent: settings.padding_percent,
    applyShadow: settings.apply_shadow,
    customStyle: settings.custom_style_prompt,
  });

  const preparedMain: { url: string; path: string }[] = [];
  try {
    for (const u of mainSourceUrls) preparedMain.push(await prepareFalSource(enrichment.id, u));
    const mainResp = await callFal(
      "fal-ai/bytedance/seedream/v4/edit",
      {
        image_urls: preparedMain.map((p) => p.url),
        prompt: mainPrompt,
        image_size: { width: settings.target_resolution, height: settings.target_resolution },
        num_images: 1,
        sync_mode: true,
        enable_safety_checker: true,
        output_format: "jpeg",
      },
      FAL_KEY,
    );
    const mainUrl = mainResp.images?.[0]?.url;
    if (!mainUrl) throw new Error("FAL nie zwróciło głównego zdjęcia");

    const mainBytes = await fetchBytes(mainUrl);
    const mainPath = `${enrichment.id}.jpg`;
    await supabaseAdmin.storage.from("regenerated-images").remove([`${enrichment.id}.webp`, `${enrichment.id}.png`]).catch(() => undefined);
    const { error: upErr } = await supabaseAdmin.storage
      .from("regenerated-images")
      .upload(mainPath, mainBytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`Upload main: ${upErr.message}`);
    const { data: pub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(mainPath);
    const mainPublic = `${pub.publicUrl}?v=${Date.now()}`;

    const usedSet = new Set(mainSourceUrls);
    const galleryCandidates = [
      ...withAB.filter((u) => !usedSet.has(u)),
      ...withA.filter((u) => !usedSet.has(u) && !withAB.includes(u)),
    ];
    const galleryTargets = galleryCandidates.slice(0, settings.max_gallery_images);
    const galleryUrls: string[] = [];
    const galleryPrompt = buildSeedreamPrompt({
      isComposite: false,
      componentA: settings.component_a,
      componentB: settings.component_b,
      paddingPercent: settings.padding_percent,
      applyShadow: settings.apply_shadow,
      customStyle: settings.custom_style_prompt,
    });

    for (let i = 0; i < galleryTargets.length; i++) {
      const src = galleryTargets[i];
      let prep: { url: string; path: string } | null = null;
      try {
        prep = await prepareFalSource(enrichment.id, src);
        const resp = await callFal(
          "fal-ai/bytedance/seedream/v4/edit",
          {
            image_urls: [prep.url],
            prompt: galleryPrompt,
            image_size: { width: settings.target_resolution, height: settings.target_resolution },
            num_images: 1,
            sync_mode: true,
            enable_safety_checker: true,
            output_format: "jpeg",
          },
          FAL_KEY,
        );
        const genUrl = resp.images?.[0]?.url;
        if (!genUrl) throw new Error("brak url");
        const bytes = await fetchBytes(genUrl);
        const gPath = `gallery/${enrichment.id}-${i + 1}.jpg`;
        const { error: gErr } = await supabaseAdmin.storage
          .from("regenerated-images")
          .upload(gPath, bytes, { contentType: "image/jpeg", upsert: true });
        if (gErr) throw new Error(gErr.message);
        const { data: gPub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(gPath);
        galleryUrls.push(`${gPub.publicUrl}?v=${Date.now()}`);
      } catch (e) {
        console.warn("gallery item failed", src, e);
      } finally {
        if (prep) {
          await supabaseAdmin.storage.from("regenerated-images").remove([prep.path]).catch(() => undefined);
        }
      }
    }

    for (let i = galleryUrls.length + 1; i <= 12; i++) {
      await supabaseAdmin.storage.from("regenerated-images").remove([`gallery/${enrichment.id}-${i}.jpg`]).catch(() => undefined);
    }

    const { error: dbErr } = await supabaseAdmin
      .from("enrichments")
      .update({
        regenerated_main_image: mainPublic,
        pinned_main_url: mainPublic,
        ai_gallery_urls: galleryUrls as never,
      } as never)
      .eq("id", enrichment.id);
    if (dbErr) throw new Error(dbErr.message);
  } finally {
    for (const p of preparedMain) {
      await supabaseAdmin.storage.from("regenerated-images").remove([p.path]).catch(() => undefined);
    }
  }
}
// ---------------------------------------------------------------------------
// Run: Firecrawl discovery — search top stores for a product and scrape 3.
// ---------------------------------------------------------------------------

type FirecrawlSearchHit = { url?: string; title?: string; description?: string };

function pickImagesFromScrape(res: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: unknown) => {
    if (typeof u !== "string") return;
    const t = u.trim();
    if (!t || !/^https?:\/\//i.test(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  const r = res as Record<string, unknown> | null;
  if (!r) return out;
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  push(meta.ogImage);
  push((meta as { "og:image"?: string })["og:image"]);
  push(meta.image);
  const md = typeof r.markdown === "string" ? r.markdown : "";
  const mdMatches = md.match(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g) ?? [];
  for (const m of mdMatches) {
    const m2 = /\((https?:[^)\s]+)\)/.exec(m);
    if (m2) push(m2[1]);
  }
  const html = typeof r.html === "string" ? r.html : "";
  const imgMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi) ?? [];
  for (const m of imgMatches) {
    const m2 = /src=["']([^"']+)["']/i.exec(m);
    if (m2) push(m2[1]);
  }
  return filterImageUrls(out).slice(0, 12);
}

// ---------------------------------------------------------------------------
// AI filter: po scrape'owaniu zostawiamy tylko dane dotyczące konkretnego
// produktu (opis, cechy, zdjęcia). Resztę odrzucamy, żeby UI / eksport nie
// pokazywały banerów, "polecanych", innych wariantów itp.
// ---------------------------------------------------------------------------

const FILTER_MODEL = "google/gemini-2.5-flash";

const FilterSchema = z.object({
  is_product_page: z.boolean(),
  product_description: z.string().max(8000).default(""),
  product_features: z
    .array(z.object({ key: z.string().min(1).max(200), value: z.string().min(1).max(2000) }))
    .max(60)
    .default([]),
  product_image_indexes: z.array(z.number()).default([]),
  rejected_reason: z.string().max(500).optional().default(""),
});

type FilteredScrape = {
  is_product_page: boolean;
  description: string;
  features: Array<{ key: string; value: string }>;
  imageUrls: string[];
  rejectedReason: string;
  usedAi: boolean;
};

async function filterScrapedForProduct(
  apiKey: string | undefined,
  product: { nazwa: string | null; kod: string | null; ean: string | null },
  pageTitle: string | null,
  pageMarkdown: string,
  candidateImages: string[],
  pageUrl: string,
): Promise<FilteredScrape> {
  const fallback: FilteredScrape = {
    is_product_page: true,
    description: pageMarkdown.slice(0, 8000),
    features: [],
    imageUrls: candidateImages,
    rejectedReason: "",
    usedAi: false,
  };
  if (!apiKey) return fallback;
  if (!pageMarkdown && !candidateImages.length) return fallback;

  const imgList = candidateImages
    .map((u, i) => `${i + 1}. ${u}`)
    .join("\n");

  const system = [
    "Jesteś filtrem treści w PIM. Otrzymasz dane scrape'owanej strony i informacje o KONKRETNYM produkcie z bazy klienta.",
    "Zwróć WYŁĄCZNIE dane dotyczące dokładnie tego produktu (ta sama marka, model, wariant — gramatura/kolor/rozmiar).",
    "POMIŃ BEZWZGLĘDNIE (to NIE jest produkt):",
    "- logo metod płatności: Blik, Visa, Mastercard, Przelewy24, PayU, DotPay, BlueMedia, Apple Pay, Google Pay, PayPal",
    "- logo i banery sklepu, certyfikaty (Bazant, „Gwarancja Najlepszej Ceny\", SSL, Opineo, Ceneo, „Bezpieczne zakupy\")",
    "- ikony kontaktu (telefon, koperta) i social media (Facebook, Instagram, YouTube, TikTok)",
    "- przyciski / linki typu „Zapytaj o produkt\", „Udostępnij\", „Dodaj do schowka\", „Napisz opinię\", newsletter",
    "- informacje o dostawie, płatnościach, gwarancji bezpiecznego zakupu, zwrotach, reklamacjach, numery telefonu i e‑maile sklepu",
    "- polecane / „zobacz też\" / „klienci kupili\", recenzje innych produktów, listingi kategorii, regulaminy, stopki, opisy ogólne sklepu",
    "- galerie/miniatury obrazków, logo brandu/producenta, ceny i kwoty (np. „2,69 zł\"), „Write a review\", Follow/Compare/Obserwuj/Porównuj",
    "- adresy sklepów stacjonarnych, kody pocztowe, godziny otwarcia, dni tygodnia (Mon-Fri / Pon-Pt), linki do Google Maps",
    "Jeśli strona NIE dotyczy tego produktu (np. listing kategorii, inny wariant, inny produkt) — ustaw is_product_page=false i podaj krótki powód w rejected_reason.",
    "product_description: spójny fragment opisu dotyczący tego produktu (MAX 3000 znaków). Bez nazw sklepów, bez cen, bez „kup teraz\", bez numerów telefonu i adresów e‑mail.",
    "product_features: konkretne cechy techniczne pary klucz/wartość (np. Materiał, Wymiary, Pojemność, Kolor). Tylko to, co dotyczy tego produktu.",
    "product_image_indexes: indeksy (1-based) WYŁĄCZNIE zdjęć przedstawiających ten produkt. Pomiń logo, ikony UI, banery, miniatury innych produktów, zdjęcia kategorii.",
    'Zwróć JSON: {"is_product_page": boolean, "product_description": string, "product_features": [{"key": string, "value": string}], "product_image_indexes": number[], "rejected_reason": string}.',
  ].join("\n");

  const user = [
    "PRODUKT (z bazy klienta):",
    `nazwa: ${product.nazwa ?? ""}`,
    `kod: ${product.kod ?? ""}`,
    `ean: ${product.ean ?? ""}`,
    "",
    `STRONA: ${pageUrl}`,
    `TYTUŁ: ${pageTitle ?? ""}`,
    "",
    "MARKDOWN STRONY (skrócony):",
    pageMarkdown.slice(0, 6000),
    "",
    "KANDYDACI ZDJĘĆ (1-based):",
    imgList || "(brak)",
  ].join("\n");

  try {
    const parsed = await callGatewayJson(apiKey, FILTER_MODEL, [
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const out = FilterSchema.parse(parsed);
    const imageUrls = out.product_image_indexes
      .map((i) => candidateImages[i - 1])
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    const dedup = filterImageUrls(imageUrls);
    return {
      is_product_page: out.is_product_page,
      description: sanitizeProductDescription(out.product_description || ""),
      features: out.product_features,
      imageUrls: dedup,
      rejectedReason: out.rejected_reason ?? "",
      usedAi: true,
    };
  } catch (e) {
    console.warn("filterScrapedForProduct failed; keeping raw:", e);
    return { ...fallback, description: sanitizeProductDescription(fallback.description), imageUrls: filterImageUrls(fallback.imageUrls) };
  }
}

export async function runFirecrawlDiscovery(productId: string, ctx?: WorkerCtx): Promise<void> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
  const aiKey = process.env.LOVABLE_API_KEY;

  const { data: product, error: pErr } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, kod, ean")
    .eq("id", productId)
    .single();
  if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

  const nazwa = (product.nazwa ?? "").trim();
  if (!nazwa) throw new Error("Produkt nie ma nazwy");

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("blacklist")
    .eq("id", product.project_id)
    .single();
  const extraBlacklist = ((project?.blacklist as string[] | null) ?? []);

  const codePart = (product.kod ?? "").trim();
  const eanPart = (product.ean ?? "").trim();
  const query = [nazwa, codePart || eanPart].filter(Boolean).join(" ").trim();

  await emit(ctx, { level: "info", message: `🔎 ${nazwa} — szukam: "${query}"`, details: { query } });

  const firecrawl = new Firecrawl({ apiKey });

  // 1) Search.
  let hits: FirecrawlSearchHit[] = [];
  try {
    const sr = (await firecrawl.search(query, {
      limit: 5,
      sources: ["web"],
    } as never)) as unknown;
    const srObj = sr as { web?: FirecrawlSearchHit[]; data?: FirecrawlSearchHit[] };
    hits = (srObj.web ?? srObj.data ?? []) as FirecrawlSearchHit[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit(ctx, { level: "error", message: `❌ ${nazwa} — Firecrawl search: ${msg}` });
    throw new Error(`Firecrawl search: ${msg}`);
  }

  const allUrls = hits.map((h) => (h.url ?? "").trim()).filter(Boolean);

  // 2) Persist raw search result (term = product name lowercased, mirrors matching).
  await supabaseAdmin
    .from("search_results")
    .insert({
      project_id: product.project_id,
      term: nazwa,
      organic_urls: allUrls as never,
    } as never);

  // 3) Filter out marketplaces / blacklist, take top 3.
  const filtered = allUrls.filter((u) => !isMarketplaceUrl(u, extraBlacklist)).slice(0, 3);
  await emit(ctx, {
    level: filtered.length ? "info" : "warn",
    message: `   ${nazwa} — ${allUrls.length} wyników, ${filtered.length} po filtrze`,
    details: { organic_urls: allUrls, filtered_urls: filtered },
  });
  if (!filtered.length) return;

  // 4) Scrape each and upsert into product_sources.
  let scraped = 0;
  let totalImages = 0;
  for (const url of filtered) {
    try {
      const scrape = (await firecrawl.scrape(url, {
        formats: ["markdown", "html"],
        onlyMainContent: true,
      } as never)) as Record<string, unknown>;
      const meta = (scrape.metadata ?? {}) as Record<string, unknown>;
      const title = (meta.title as string | undefined) ?? (meta.ogTitle as string | undefined) ?? null;
      const rawMarkdown = typeof scrape.markdown === "string" ? scrape.markdown : "";
      const candidateImages = pickImagesFromScrape(scrape);
      const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();

      await emit(ctx, {
        level: "info",
        message: `   🧠 ${host} — filtruję dane pod produkt (${candidateImages.length} kandydatów zdjęć)`,
        details: { url, candidates: candidateImages.length },
      });

      const filteredData = await filterScrapedForProduct(
        aiKey,
        { nazwa: product.nazwa ?? null, kod: product.kod ?? null, ean: product.ean ?? null },
        title,
        rawMarkdown,
        candidateImages,
        url,
      );

      if (!filteredData.is_product_page && filteredData.usedAi) {
        await emit(ctx, {
          level: "warn",
          message: `   ⚠️ ${host} — strona nie dotyczy produktu, pominięto${filteredData.rejectedReason ? ` (${filteredData.rejectedReason})` : ""}`,
          details: { url, reason: filteredData.rejectedReason },
        });
        continue;
      }

      const rejectedImages = candidateImages.filter((u) => !filteredData.imageUrls.includes(u));

      await supabaseAdmin
        .from("product_sources")
        .upsert(
          {
            project_id: product.project_id,
            url,
            title,
            description: filteredData.description || null,
            images: filteredData.imageUrls as never,
            extra_images: [] as never,
            raw: {
              source: "firecrawl",
              metadata: meta,
              ai_filter: {
                used: filteredData.usedAi,
                features: filteredData.features,
                rejected_images: rejectedImages,
                at: new Date().toISOString(),
              },
            } as never,
          } as never,
          { onConflict: "project_id,url" },
        );
      scraped++;
      totalImages += filteredData.imageUrls.length;
      await emit(ctx, {
        level: "success",
        message: `   ✓ ${host} — ${filteredData.imageUrls.length}/${candidateImages.length} zdjęć produktu, ${filteredData.features.length} cech`,
        details: {
          url,
          kept_images: filteredData.imageUrls.length,
          total_candidates: candidateImages.length,
          features: filteredData.features.length,
          ai: filteredData.usedAi,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("firecrawl scrape failed", url, e);
      await emit(ctx, { level: "warn", message: `   ⚠️ ${url} — ${msg}`, details: { url, error: msg } });
    }
  }
  await emit(ctx, {
    level: scraped ? "success" : "warn",
    message: `✅ ${nazwa} — zescrape'owano ${scraped}/${filtered.length} (${totalImages} zdjęć)`,
    details: { scraped, total: filtered.length, images: totalImages },
  });
}
