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
import { extractDescriptionSection, filterImageUrls, sanitizeProductDescription } from "./source-cleanup";
import {
  slugifyPl as slugifyPlShared,
  clampName as clampNameShared,
  clampMetaDescription as clampMetaDescriptionShared,
  dedupeKeywords as dedupeKeywordsShared,
  GOLDEN_SEO_SYSTEM_PROMPT,
  sanitizeGoldenDescriptionHtml,
  ALLEGRO_DESCRIPTION_SYSTEM_PROMPT,
  sanitizeAllegroDescriptionHtml,
} from "./seo";
import Firecrawl from "@mendable/firecrawl-js";

const GOLDEN_MODEL = "google/gemini-3-flash-preview";
const VISION_MODEL = "google/gemini-2.5-flash";
const CLASSIFY_MODEL = "google/gemini-2.5-flash";
const FAL_BASE = "https://fal.run";
const FAL_QUEUE_BASE = "https://queue.fal.run";

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
  deadline?: number;
  bulkJobId?: string;
  bulkPayload?: Record<string, unknown> | null;
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

// SHA-256 hex digest via Web Crypto (available in Cloudflare Workers runtime).
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Deterministic fallback used when the AI gateway call fails — mirrors the
// original hardcoded prompts so generation never blocks on the translator.
function fallbackPrompts(args: {
  productName: string;
  productDesc: string;
  requirementsPl: string;
  projectStyle: string;
}): { thumbnail_prompt: string; lifestyle_prompt: string } {
  const { productName, productDesc, requirementsPl, projectStyle } = args;
  const thumb = [
    `Product packshot for an e-commerce catalog thumbnail.`,
    `SUBJECT: The exact product visible in the source image — "${productName}".`,
    productDesc ? `PRODUCT DETAILS: ${productDesc}` : ``,
    `BACKGROUND: Pure white #FFFFFF seamless studio.`,
    `CONTEXTUAL PROPS: Add 1–3 small, tasteful props that are clearly related to what this product is used for (e.g. a few fresh green leaves for a garden shear, coffee beans for a grinder, wood shavings for a chisel). Arrange them asymmetrically around the product without covering it. Do not add unrelated objects.`,
    `FRAMING: Square 1:1, product centered, ~75-85% of frame.`,
    `SHADOW: Soft realistic contact shadows.`,
    `PRESERVE: Every label, logo, colour, material and proportion — pixel-faithful to the source.`,
    `CRITICAL COLOUR: Preserve the product's own colour(s) exactly — do NOT whiten, desaturate, bleach, lighten or shift hue. Only the background is white; the product keeps its original colour.`,
    `REMOVE: Watermarks, store logos, price tags, overlay text not physically printed on the product.`,
    requirementsPl ? `EXTRA USER REQUIREMENTS (translated from Polish): ${requirementsPl}` : ``,
  ].filter(Boolean).join(" ");
  const life = [
    `Realistic lifestyle product photograph for a catalog visualisation.`,
    `SUBJECT: The EXACT product from the source image — "${productName}". Keep it visually identical.`,
    productDesc ? `PRODUCT DETAILS: ${productDesc}` : ``,
    projectStyle ? `SCENE STYLE: ${projectStyle}` : `SCENE: A natural, realistic environment appropriate for how this product is actually used. Soft daylight, believable props.`,
    `FRAMING: Square 1:1, product is the hero in sharp focus, realistic scale.`,
    `PRESERVE: Every label, logo, colour and material — identical to source.`,
    `CRITICAL COLOUR: Preserve the product's own colour(s) exactly — do NOT whiten, desaturate, bleach, lighten or shift hue. Only the scene changes; the product keeps its original colour.`,
    `AVOID: Fantasy elements, unrealistic scale, floating objects, distorted labels, duplicate products, watermarks, text overlays.`,
    requirementsPl ? `EXTRA USER REQUIREMENTS (translated from Polish): ${requirementsPl}` : ``,
  ].filter(Boolean).join(" ");
  return { thumbnail_prompt: thumb, lifestyle_prompt: life };
}

// Translate Polish requirements + product context into two production-ready
// EN prompts for fal-ai/nano-banana-pro/edit (thumbnail + lifestyle).
export async function buildFalPromptsFromPolish(args: {
  productName: string;
  productDesc: string;
  requirementsPl: string;
  projectStyle: string;
}): Promise<{ thumbnail_prompt: string; lifestyle_prompt: string }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const system = [
    `You write English prompts for the fal-ai/nano-banana-pro image EDIT model.`,
    `The model receives 1+ reference photos of a real product and must reproduce it faithfully.`,
    `You return exactly two prompts as JSON: { "thumbnail_prompt": string, "lifestyle_prompt": string }.`,
    ``,
    `THUMBNAIL PROMPT rules:`,
    `- Square 1:1 e-commerce catalog thumbnail on a pure white seamless studio background (#FFFFFF).`,
    `- Enrich the frame with 1–3 small CONTEXTUAL PROPS that are clearly and logically related to the product (e.g. fresh leaves for garden shears, coffee beans for a grinder, wood shavings for chisels). Props sit asymmetrically around the product, do not cover it, and do not compete visually.`,
    `- Soft realistic contact shadow. Product fills ~75–85% of the frame.`,
    `- Preserve every label, logo, brand mark, colour, material and proportion pixel-faithfully. Remove watermarks and store overlays that are not physically printed on the product.`,
    `- Preserve the product's own colour(s) letter-for-letter — hue, saturation and tone identical to the reference. NEVER whiten, desaturate, bleach, lighten or shift the hue of the product body, cover, packaging or printed graphics. Only the background changes to pure white; product colours stay identical.`,
    `- Quote any visible printed text on the product LITERALLY, in double quotes, letter-for-letter, e.g. preserve label "PRODUCT NAME" letter-for-letter — do not paraphrase, translate or invent characters.`,
    `- Change ONLY the background/scene and props. Keep product, logo, printed text, colours, materials and proportions EXACTLY the same, preserve style, lighting on the product, and textures.`,
    `- Never redraw, restyle or invent the logo/brand mark. Reproduce ONLY what is visible in the reference. If the logo/text on the reference is small, blurry or partially cropped, keep it at that same resolution and sharpness — do NOT "enhance" or re-letter it.`,
    `- 2K studio quality, sharp product, no motion blur, no compression artifacts, photorealistic e-commerce photography.`,
    ``,
    `LIFESTYLE PROMPT rules:`,
    `- Square 1:1, realistic in-use scene. Product is the hero, sharp focus, realistic scale.`,
    `- Believable environment, natural light, tasteful props.`,
    `- Preserve every label, logo, colour and material. Avoid fantasy elements, distortion, duplicates, watermarks or text overlays.`,
    `- Preserve the product's own colour(s) letter-for-letter — hue, saturation and tone identical to the reference. NEVER whiten, desaturate, bleach, lighten or shift the hue of the product itself. Only the scene/background changes; product colours stay identical to the reference.`,
    `- Quote any visible printed text on the product LITERALLY, in double quotes, letter-for-letter (e.g. preserve label "PRODUCT NAME" letter-for-letter). Never redraw, restyle or invent the logo/brand mark — reproduce ONLY what is visible in the reference; if it is small or blurry, keep it that way.`,
    `- Change ONLY the scene, background and props. Keep product, logo, printed text, colours, materials and proportions EXACTLY the same.`,
    `- Use concrete photographic language in EVERY lifestyle prompt — always specify:`,
    `    • camera angle (e.g. "eye-level 3/4 view", "low angle hero shot", "top-down flat lay"),`,
    `    • focal length + depth of field (e.g. "50mm, shallow depth of field, background softly blurred", "35mm, deep focus"),`,
    `    • light direction + colour temperature (e.g. "soft window light from the left, warm 4500K", "overcast daylight, neutral 5500K"),`,
    `    • quality tags: "sharp product, no motion blur, photorealistic, 4K commercial photography".`,
    ``,
    `If the user supplied Polish requirements, they OVERRIDE defaults for scene, props, lighting, mood — but never the "preserve the product faithfully" rules.`,
    `META RULE: the lifestyle prompt is INVALID unless it contains at least one phrase about camera angle, one about lighting (direction + temperature), and one about depth of field. Include them explicitly every time.`,
    `META RULE (colour): BOTH prompts MUST contain an explicit sentence forbidding any colour change on the product itself (no whitening, desaturation, bleaching or hue shift). Include it every time.`,
    `Write both prompts in fluent, concrete English with short imperative sentences. No preamble, no markdown, JSON only.`,
  ].join("\n");

  const user = [
    `PRODUCT NAME: ${args.productName || "(unnamed)"}`,
    `PRODUCT DESCRIPTION: ${args.productDesc || "(none)"}`,
    `PROJECT SCENE STYLE (EN, optional): ${args.projectStyle || "(none)"}`,
    `USER REQUIREMENTS IN POLISH (translate & apply):`,
    args.requirementsPl || "(none — use defaults from the rules above)",
  ].join("\n");

  const res = await callGatewayJson(apiKey, "google/gemini-3.1-pro-preview", [
    { role: "system", content: system },
    { role: "user", content: user },
  ]) as { thumbnail_prompt?: string; lifestyle_prompt?: string };

  const t = (res.thumbnail_prompt ?? "").trim();
  const l = (res.lifestyle_prompt ?? "").trim();
  if (!t || !l) throw new Error("AI returned empty prompts");
  return { thumbnail_prompt: t, lifestyle_prompt: l };
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
// SEO helpers — re-export shared helpers so existing call sites keep working.
// ---------------------------------------------------------------------------

export const slugifyPl = slugifyPlShared;
const clampName = clampNameShared;
const clampMetaDescription = clampMetaDescriptionShared;
const dedupeKeywords = dedupeKeywordsShared;

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
    const err = new Error(`FAL ${path} ${res.status}: ${txt.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as FalResp;
}

type FalQueueRequest = {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
};

type FalQueueStatus =
  | { pending: true; status: string }
  | { pending: false; response: FalResp };

type PimVisualizationSlot = {
  slot: number;
  request?: FalQueueRequest;
  mode?: "edit" | "safe-edit" | "generate";
  sourceUrl?: string;
  sourcePath?: string;
  lastError?: string;
};

type PimVisualizationProgress = {
  products?: Record<string, PimVisualizationSlot>;
  prompts?: Record<string, string>;
};

function falHttpError(path: string, status: number, text: string): Error & { status?: number } {
  const err = new Error(`FAL ${path} ${status}: ${text.slice(0, 300)}`) as Error & { status?: number };
  err.status = status;
  return err;
}

function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

async function submitFalQueue(path: string, body: unknown, apiKey: string): Promise<FalQueueRequest> {
  const res = await fetch(`${FAL_QUEUE_BASE}/${path}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw falHttpError(path, res.status, txt);
  }
  const data = (await res.json()) as Partial<FalQueueRequest>;
  if (!data.request_id || !data.status_url || !data.response_url) {
    throw new Error("FAL queue: brak request_id/status_url/response_url");
  }
  return {
    request_id: data.request_id,
    status_url: data.status_url,
    response_url: data.response_url,
    cancel_url: data.cancel_url,
  };
}

async function readFalQueue(req: FalQueueRequest, apiKey: string): Promise<FalQueueStatus> {
  const statusRes = await fetch(req.status_url, {
    headers: { Authorization: `Key ${apiKey}`, Accept: "application/json" },
  });
  const statusText = await statusRes.text().catch(() => "");
  if (!statusRes.ok) throw falHttpError("queue/status", statusRes.status, statusText);

  let statusJson: Record<string, unknown> = {};
  try { statusJson = JSON.parse(statusText) as Record<string, unknown>; } catch { statusJson = {}; }
  const status = String(statusJson.status ?? statusJson.state ?? "").toUpperCase();
  if (status && status !== "COMPLETED" && status !== "FAILED" && status !== "ERROR") {
    return { pending: true, status };
  }
  if (status === "FAILED" || status === "ERROR") {
    const rawError = statusJson.error ?? statusJson.detail ?? statusJson.message ?? statusText;
    throw new Error(typeof rawError === "string" ? rawError : JSON.stringify(rawError).slice(0, 300));
  }

  const responseRes = await fetch(req.response_url, {
    headers: { Authorization: `Key ${apiKey}`, Accept: "application/json" },
  });
  const responseText = await responseRes.text().catch(() => "");
  if (responseRes.status === 202) return { pending: true, status: "IN_PROGRESS" };
  if (!responseRes.ok) throw falHttpError("queue/response", responseRes.status, responseText);
  return { pending: false, response: JSON.parse(responseText) as FalResp };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const parsed = await callGatewayJson(apiKey, GOLDEN_MODEL, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const out = GoldenSchema.parse(parsed);
    const sanitizeStr = (s: string) => sanitize(s, blacklist) ?? s;
    const rawName = sanitize(out.name, blacklist) ?? "";
    const name = clampName(rawName, 70);
    const rawDescription = sanitize(out.description, blacklist) ?? "";
    const metaDescription = clampMetaDescription(sanitizeStr(out.meta_description ?? ""), 160);
    // Re-slugify by ourselves — gwarantujemy poprawność niezależnie od tego co zwróciło AI.
    const slugSource = (out.slug && out.slug.trim()) ? out.slug : name;
    const slug = slugifyPl(slugSource, 75);
    const seoKeywords = dedupeKeywords((out.seo_keywords ?? []).map(sanitizeStr));
    const newFeatures = (out.features ?? [])
      .map((f) => ({ key: sanitizeStr(f.key), value: sanitizeStr(f.value) }))
      .filter((f) => f.key && f.value);
    const existingFeatures = ((enrichment as { golden_features?: unknown }).golden_features ?? []) as Array<{ key: string; value: string }>;
    const shouldWriteFeatures = newFeatures.length > 0 && (mode === "all" || !existingFeatures.length);
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
  lines.push(`BACKGROUND = flat solid #FFFFFF fill, RGB(255,255,255), luminance L=100, a mathematically flat white plane. NO lighting variation, NO falloff, NO vignette, NO gradient, NO ambient shadow bleeding into the background, NO soft-box reflection, NO seamless paper curve, NO paper texture. Identical pixel value #FFFFFF in ALL FOUR CORNERS and along ALL FOUR EDGES of the canvas. If anything on the background is darker than #FAFAFA anywhere in the frame, the output is WRONG. "Whiter/brighter" applies to the BACKGROUND ONLY — never to the product itself.`);
  lines.push(`CRITICAL COLOUR (product): Preserve the product's own colour(s) pixel-faithfully — hue, saturation and tone identical to the source reference. DO NOT desaturate, whiten, lighten, brighten, bleach or shift the hue of the product body, cover, packaging, printed graphics or labels. If the source product is green, the output stays that exact green; the same applies to every other colour. The product must not be tinted to match the white background.`);
  if (opts.isComposite && opts.componentB) {
    lines.push(`COMPOSITION: Place "${opts.componentB}" naturally beside "${opts.componentA}" in one frame. Both elements in sharp focus, realistic relative scale. The products retain their original colours — only the surroundings become pure white.`);
  } else {
    lines.push(`SUBJECT: Move the exact same product ("${opts.componentA}") onto a clean pure white #FFFFFF seamless studio background. The product retains its original colour(s) — only the surroundings become pure white.`);
  }
  lines.push(`FRAMING: Scale the product UP so it fills ${fill}% of the frame in BOTH width and height. Center it.`);
  lines.push(opts.applyShadow
    ? `SHADOW: Add a soft realistic contact shadow directly under the product only.`
    : `SHADOW: No shadow. Product floats cleanly on pure white.`);
  lines.push(`PRESERVE: Keep the product's colour EXACTLY as in the source, including saturation and tone. Keep every printed label, logo, brand name, illustration, material and proportions exactly as in the source.`);
  lines.push(`WATERMARK REMOVAL: Remove watermarks, store logos, website URLs, photo credits, shop names and semi-transparent overlay text that are NOT physically printed on the product packaging itself.`);
  if (opts.customStyle && opts.customStyle.trim()) lines.push(`STYLE: ${opts.customStyle.trim()}`);
  lines.push(`AVOID: gray background, light gray, silver, off-white, warm white, cool white, cream/beige/ivory background, studio seamless curve, ambient shadow bleeding into background, gradient from light to slightly darker, any pixel below 250,250,250 on the background, tint, vignette, paper texture, tiny product, off-center, blurred text, regenerated artwork, missing labels, visible watermarks, whitened/desaturated/bleached product body, colour drift, product tinted to match the background.`);
  return lines.join(" ");
}

export async function runRegenerateMedia(
  productId: string,
  ctx?: WorkerCtx,
  overrides?: { maxGallery?: number; targetResolution?: number },
): Promise<void> {
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

  const baseSettings = await loadMediaSettings(product.project_id);
  const settings = {
    ...baseSettings,
    max_gallery_images:
      typeof overrides?.maxGallery === "number"
        ? Math.max(0, Math.min(12, overrides.maxGallery))
        : baseSettings.max_gallery_images,
    target_resolution:
      typeof overrides?.targetResolution === "number"
        ? Math.max(512, Math.min(4096, overrides.targetResolution))
        : baseSettings.target_resolution,
  };
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

/**
 * Sklepy serwują miniatury, a po kliknięciu w galerię pokazuje się duża
 * wersja. Spróbuj podmienić URL miniatury na URL "powiększonego" wariantu
 * dla typowych platform e-commerce. Zwracamy oryginał, jeśli żaden wzorzec
 * nie pasuje — dalsza walidacja wymiarów dzieje się i tak w pipeline.
 */
function upgradeToLargeImageUrl(input: string): string {
  let u = input;
  // Speed-line CDN: /ai/140/... and /ai/400%2F... are resized variants;
  // the same path under /ai/2000/ is the lightbox / source-size product photo.
  u = u.replace(/(https?:\/\/static\.speedline\.dk\/ai\/)(?:38|60|70|140|350|400|600|800|1100|1600)(?=\/|%2f)/i, "$12000");
  // WooCommerce / WP: usuń sufiks rozmiaru "-150x150" / "-1024x768" przed rozszerzeniem.
  u = u.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "$1");
  // PrestaShop: -home_default / -cart_default / -small_default / -medium_default → -large_default
  u = u.replace(/-(?:home|cart|small|medium|thickbox|category|product)_default\./i, "-large_default.");
  // PrestaShop bez _default: -small / -cart / -home / -thickbox przed rozszerzeniem.
  u = u.replace(/-(?:home|cart|small|medium|thickbox|category)(\.(?:jpe?g|png|webp|avif))/i, "$1");
  // Shopify CDN: _small / _compact / _medium / _large / _grande / _100x / _240x → _2048x.
  u = u.replace(/_(?:pico|icon|thumb|small|compact|medium|large|grande)(\.|@)/i, "_2048x$1");
  u = u.replace(/_\d{1,4}x(?:\d{1,4})?(\.(?:jpe?g|png|webp|avif))/i, "_2048x$1");
  // Ogólny sufiks rozmiaru przed rozszerzeniem: -thumb / -thumbnail / -mini / -tiny / -xs / -preview / -small.
  u = u.replace(/[-_](?:thumb(?:nail)?|mini|tiny|xs|xxs|preview|small)(\.(?:jpe?g|png|webp|avif))/i, "$1");
  // IdoSell v2: nazwapliku-1_360.jpg / _100.jpg → nazwapliku-1.jpg.
  u = u.replace(/(-\d+)_\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "$1$2");
  u = u.replace(/_\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "$1");
  // Magento: /cache/<hash>/small_image/<W>x<H>/ lub /thumbnail/ — wytnij cały segment /cache/.../  i typ rozmiaru.
  u = u.replace(/\/cache\/[a-f0-9]+\/(?:small_image|thumbnail|image)\/\d+x\d+\//i, "/");
  u = u.replace(/\/cache\/[a-f0-9]+\//i, "/");
  // IdoSell / Shoper: /small/ /s/ /m/ /thumb/ → /source/ lub /big/.
  u = u.replace(/\/(?:small|thumb|thumbs|thumbnails|mini)\//i, "/source/");
  u = u.replace(/\/(s|m)\/(\d)/i, "/source/$2");
  // Ogólne segmenty rozmiaru w ścieżce → usuń.
  u = u.replace(/\/(?:thumbnail|thumbnails|thumbs|tiny|preview|resized|scaled|xs|xxs|mini|miniatures|miniatury|w\d{2,4}|h\d{2,4})\//gi, "/");
  // Cloudinary: /upload/w_200,h_200,c_fill/ → /upload/.
  u = u.replace(/\/upload\/(?:[a-z]_[^/,]+,?)+\//i, "/upload/");
  // Query-size params: w/width/h/height/size/maxw/maxh/imwidth/imheight — usuń.
  try {
    const parsed = new URL(u);
    const drop = ["w", "width", "h", "height", "size", "maxw", "maxh", "imwidth", "imheight", "fit", "resize"];
    let mutated = false;
    for (const k of drop) {
      if (parsed.searchParams.has(k)) {
        parsed.searchParams.delete(k);
        mutated = true;
      }
    }
    if (mutated) u = parsed.toString();
  } catch { /* keep u */ }
  // Google CDN size hint: =s100 / =w200-h200 → =s2048.
  u = u.replace(/=(?:s|w|h)\d{1,4}(-(?:w|h|s)\d{1,4})*([?&]|$)/i, "=s2048$2");
  return u;
}

/**
 * Z URL-a wyciągnij minimalny zadeklarowany wymiar (px) — jeśli da się
 * odczytać go z nazwy pliku / query. Zwracamy null gdy URL nie koduje rozmiaru.
 */
function inferMinDimensionFromUrl(url: string): number | null {
  const speedlineAi = /\/ai\/(\d{2,4})(?:\/|%2f)/i.exec(url);
  if (speedlineAi) return parseInt(speedlineAi[1], 10);
  const wh = /[_\-/](\d{2,4})x(\d{2,4})(?:\.|_|-|\/|$)/i.exec(url);
  if (wh) return Math.min(parseInt(wh[1], 10), parseInt(wh[2], 10));
  const s = /[=_\-/](?:s|w|h)(\d{2,4})(?:[?&\-]|$)/i.exec(url);
  if (s) return parseInt(s[1], 10);
  return null;
}

const PRODUCT_PATH_HINTS = [
  "/product", "/products", "/galeria", "/gallery", "/media/catalog/product",
  "/zdjecia", "/zdjęcia", "/upload/product", "/uploads/product", "/produkty",
  "/_data/products", "/photos/products",
];

function looksLikeProductPath(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return PRODUCT_PATH_HINTS.some((h) => p.includes(h));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wycinamy z HTML sekcje "related / see more / polecane / klienci kupili"
// PRZED ekstrakcją zdjęć. Karuzele powiązanych produktów mają identyczny
// kształt DOM co główna galeria (te same anchor→img, srcset, /product/ w
// ścieżce), więc AI-filter potem myli inne warianty marki z produktem.
// ---------------------------------------------------------------------------

const RELATED_TOKENS = [
  "related", "cross-sell", "crosssell", "cross_sell",
  "upsell", "up-sell", "up_sell",
  "you-may-also-like", "you_may_also_like", "youmayalsolike",
  "also-bought", "also_bought", "alsobought",
  "customers-also", "customers_also",
  "recommend", "similar", "see-more", "seemore",
  "more-products", "more_products", "more-from",
  "product-suggestions", "product_suggestions", "suggested-products",
  "polecane", "podobne", "klienci-kupili", "klienci_kupili",
  "zobacz-tez", "zobacz_tez", "wiecej-produktow",
];

const RELATED_ATTR_RE = new RegExp(
  `(?:class|id)\\s*=\\s*["'][^"']*(?:${RELATED_TOKENS.join("|")})[^"']*["']`,
  "i",
);

const RELATED_HEADING_RE =
  /see\s+more|related|you\s+may\s+also\s+like|customers?\s+also\s+bought|similar\s+products|more\s+from|polecane|podobne\s+produkty|klienci\s+kupili|zobacz\s+te[żz]|wi[ęe]cej\s+produkt[óo]w/i;

function stripElementsByAttr(html: string, tag: string): string {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  let result = html;
  let guard = 0;
  while (guard++ < 50) {
    openRe.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    let found: { start: number; openEnd: number } | null = null;
    while ((match = openRe.exec(result))) {
      if (RELATED_ATTR_RE.test(match[0])) {
        found = { start: match.index, openEnd: match.index + match[0].length };
        break;
      }
    }
    if (!found) break;
    // Znajdź zbalansowane zamknięcie tego samego taga.
    const scanRe = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    scanRe.lastIndex = found.openEnd;
    let depth = 1;
    let endIdx = -1;
    let s: RegExpExecArray | null;
    while ((s = scanRe.exec(result))) {
      if (s[0][1] === "/") {
        depth--;
        if (depth === 0) {
          endIdx = s.index + s[0].length;
          break;
        }
      } else {
        depth++;
      }
      if (scanRe.lastIndex - found.start > 400_000) break; // safety
    }
    if (endIdx < 0) {
      // Brak zamknięcia — utnij od kontenera do końca stringa.
      result = result.slice(0, found.start);
      break;
    }
    result = result.slice(0, found.start) + result.slice(endIdx);
  }
  return result;
}

function stripRelatedHeadingSections(html: string): string {
  // Wytnij od nagłówka pasującego do RELATED_HEADING_RE do kolejnego
  // nagłówka tego samego/wyższego poziomu albo końca <main>/<body>.
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]{0,400}?)<\/h\1>/gi;
  const cuts: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html))) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!RELATED_HEADING_RE.test(text)) continue;
    const level = parseInt(m[1], 10);
    const start = m.index;
    // Szukaj kolejnego nagłówka poziomu <= level.
    const stopRe = new RegExp(`<h([1-${level}])\\b`, "gi");
    stopRe.lastIndex = m.index + m[0].length;
    const stopMatch = stopRe.exec(html);
    const end = stopMatch ? stopMatch.index : html.length;
    cuts.push({ start, end });
  }
  if (!cuts.length) return html;
  // Wytnij od tyłu, żeby nie przesuwać indeksów.
  let out = html;
  for (let i = cuts.length - 1; i >= 0; i--) {
    out = out.slice(0, cuts[i].start) + out.slice(cuts[i].end);
  }
  return out;
}

function stripRelatedProductBlocks(html: string): string {
  let out = html;
  for (const tag of ["section", "aside", "div", "ul"]) {
    out = stripElementsByAttr(out, tag);
  }
  out = stripRelatedHeadingSections(out);
  return out;
}

/**
 * Wyciąga URL-e zdjęć produktu wyłącznie z galerii (lightbox/zoom).
 * Pomijamy `metadata.ogImage` i markdown `![](...)` (to zwykle banery
 * udostępnień, polecane produkty albo logo brandu).
 */
export function pickImagesFromScrape(res: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    // Dwukrotny upgrade — czasem pierwsze przejście odsłania kolejny wzorzec.
    let t = upgradeToLargeImageUrl(raw.trim());
    t = upgradeToLargeImageUrl(t);
    if (!t || !/^https?:\/\//i.test(t)) return;
    if (seen.has(t)) return;
    const minDim = inferMinDimensionFromUrl(t);
    if (minDim !== null && minDim < 400) return;
    seen.add(t);
    out.push(t);
  };

  const r = res as Record<string, unknown> | null;
  if (!r) return out;

  const rawHtml = typeof r.rawHtml === "string" ? r.rawHtml : (typeof r.html === "string" ? r.html : "");
  const html = rawHtml ? stripRelatedProductBlocks(rawHtml) : "";

  if (html) {
    // 1) Lightbox/zoom: <a href="...jpg|png|webp">...<img...></a>
    const anchorRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:jpe?g|png|webp|avif))(?:\?[^"']*)?["'][^>]*>[\s\S]{0,800}?<img\b/gi;
    for (let m: RegExpExecArray | null; (m = anchorRe.exec(html)); ) push(m[1]);

    // 2) data-* atrybuty na <img> sugerujące "powiększenie".
    const dataAttrs = [
      "data-zoom-image", "data-large", "data-large_image", "data-src-large",
      "data-image", "data-full", "data-original", "data-big", "data-hires",
      "data-zoom", "data-zoom-src", "data-lazy-src", "data-lazy",
      "data-flickity-lazyload", "data-flickity-lazyload-src",
      "data-splide-lazy", "data-splide-lazy-src", "data-glide-lazy",
      "data-thumb-large", "data-photoswipe-src", "data-fancybox-href",
      "data-mfp-src", "data-image-large", "data-image-src", "data-hires-src",
      "data-src",
    ];
    for (const attr of dataAttrs) {
      const re = new RegExp(`<[^>]+\\b${attr}\\s*=\\s*["']([^"']+)["']`, "gi");
      for (let m: RegExpExecArray | null; (m = re.exec(html)); ) push(m[1]);
    }

    // 2b) Galerie JS: np. Speed-line trzyma listę plików w data-gallery-images,
    // a rozmiar miniatur w data-gallery-size. Zawsze budujemy wariant 2000px.
    const galleryRe = /<[^>]+\bdata-gallery-images\s*=\s*["']([^"']+)["'][^>]*>/gi;
    for (let m: RegExpExecArray | null; (m = galleryRe.exec(html)); ) {
      const tag = m[0];
      const encoded = m[1]
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&amp;/g, "&");
      const cdn = /\bdata-gallery-cdn\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
      try {
        const parsed = JSON.parse(encoded) as unknown;
        if (!Array.isArray(parsed)) continue;
        for (const item of parsed) {
          if (typeof item !== "string" || !item) continue;
          const path = item.startsWith("http") ? item : `${cdn.replace(/\/$/, "")}/ai/2000${item.startsWith("/") ? item : `/${item}`}`;
          push(path);
        }
      } catch { /* skip malformed gallery JSON */ }
    }

    // 3) srcset (także data-srcset) — bierz największy wariant.
    const srcsetRe = /<(?:img|source)\b[^>]*\b(?:data-)?srcset\s*=\s*["']([^"']+)["']/gi;
    for (let m: RegExpExecArray | null; (m = srcsetRe.exec(html)); ) {
      const list = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      let bestUrl: string | null = null;
      let bestW = -1;
      for (const item of list) {
        const parts = item.split(/\s+/);
        const u = parts[0];
        const desc = parts[1] ?? "";
        const w = /^(\d+)w$/i.exec(desc);
        const width = w ? parseInt(w[1], 10) : 0;
        if (width >= bestW) { bestW = width; bestUrl = u; }
      }
      if (bestUrl && bestW >= 400) push(bestUrl);
      else if (bestUrl && bestW < 0) push(bestUrl); // brak deklaracji szer. — wpuść
    }

    // 4) <img src=...> tylko jeśli ścieżka wygląda na katalog produktów.
    const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    for (let m: RegExpExecArray | null; (m = imgRe.exec(html)); ) {
      const src = m[1];
      if (looksLikeProductPath(src)) push(src);
    }

    // 5) <link rel="preload" as="image" href="...">
    const preloadRe = /<link\b[^>]*\brel\s*=\s*["']preload["'][^>]*\bas\s*=\s*["']image["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
    for (let m: RegExpExecArray | null; (m = preloadRe.exec(html)); ) push(m[1]);
    const preloadRe2 = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']preload["'][^>]*\bas\s*=\s*["']image["']/gi;
    for (let m: RegExpExecArray | null; (m = preloadRe2.exec(html)); ) push(m[1]);

    // 6) JSON-LD: <script type="application/ld+json">…</script> — pole "image".
    const jsonLdRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (let m: RegExpExecArray | null; (m = jsonLdRe.exec(html)); ) {
      const body = m[1].trim();
      if (!body) continue;
      try {
        const parsed = JSON.parse(body);
        const stack: unknown[] = [parsed];
        while (stack.length) {
          const node = stack.pop();
          if (!node) continue;
          if (Array.isArray(node)) { for (const it of node) stack.push(it); continue; }
          if (typeof node !== "object") continue;
          const obj = node as Record<string, unknown>;
          const img = obj.image ?? obj.contentUrl;
          if (typeof img === "string") push(img);
          else if (Array.isArray(img)) {
            for (const it of img) {
              if (typeof it === "string") push(it);
              else if (it && typeof it === "object" && typeof (it as { url?: unknown }).url === "string") push((it as { url: string }).url);
            }
          } else if (img && typeof img === "object" && typeof (img as { url?: unknown }).url === "string") {
            push((img as { url: string }).url);
          }
          for (const v of Object.values(obj)) {
            if (v && (Array.isArray(v) || typeof v === "object")) stack.push(v);
          }
        }
      } catch { /* skip malformed JSON-LD */ }
    }
  }

  // 6b) Markdown z Firecrawl często zawiera same miniatury z galerii; po
  // upgradeToLargeImageUrl potrafią wskazać pełne zdjęcia (np. Speed-line /ai/140 → /ai/2000).
  const markdown = typeof r.markdown === "string" ? r.markdown : "";
  if (markdown) {
    const mdImgRe = /!\[[^\]]*\]\((https?:\/\/[^\s)]+(?:\s[^)]*)?)\)/gi;
    for (let m: RegExpExecArray | null; (m = mdImgRe.exec(markdown)); ) {
      const cand = m[1].trim();
      if (looksLikeProductPath(cand)) push(cand);
    }
  }

  // 7) metadata.ogImage / metadata["og:image"] — pełny obraz udostępniania.
  const meta = r.metadata as Record<string, unknown> | undefined;
  if (meta) {
    const cand = [meta.ogImage, meta["og:image"], meta.twitterImage, meta["twitter:image"]];
    for (const c of cand) if (typeof c === "string") push(c);
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

  const cappedImages = candidateImages.slice(0, 20);
  const imgList = cappedImages
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
    "- ANGIELSKIE chrome sklepu: SKU, UPC, Current Stock, Adding to cart, Out of stock, Email when available, Was, Now, You save, NaN%",
    "- UK Shipping, Standard Delivery, Click & Collect, Photo ID, Restricted products, Ship to Local RFD, International Shipping, import duties, customs, Bank holidays, postal strikes, remote postcodes",
    "- Exchanges & Refunds, Return Form, 28 days of purchase, original packaging, product labels attached",
    "- CAŁE sekcje markdown: '## Reviews', '## Shipping', '## Delivery', '## Returns', '## Payment', '## Warranty', '## Related', '## You may also like', '## About', '## Contact', '## FAQ'",
    "- ceny w GBP/EUR/USD/PLN (£30.00, $, €), separatory '* * *' / '---' / '___'",
    "Jeśli strona NIE dotyczy tego produktu (np. listing kategorii, inny wariant, inny produkt) — ustaw is_product_page=false i podaj krótki powód w rejected_reason.",
    "product_description: spójny fragment opisu dotyczący tego produktu (MAX 3000 znaków). Bez nazw sklepów, bez cen, bez „kup teraz\", bez numerów telefonu i adresów e‑mail.",
    "JĘZYK: product_description MUSI być po polsku. Jeżeli źródło jest po angielsku (lub w innym języku), PRZETŁUMACZ na naturalny język polski, zachowując DOSŁOWNIE: nazwę produktu, markę, model, wariant, gramaturę, kaliber, jednostki, oznaczenia techniczne. Nie dopisuj informacji handlowych, które nie występują w źródle.",
    "Jeżeli sekcja opisu na stronie jest bardzo krótka (jedno zdanie, sama nazwa) — zwróć krótki opis albo pusty string, NIE dopisuj chrome sklepu ani informacji o wysyłce.",
    "product_features: konkretne cechy techniczne pary klucz/wartość (np. Materiał, Wymiary, Pojemność, Kolor). Tylko to, co dotyczy tego produktu.",
    "product_features: klucze po polsku (Kaliber, Masa pocisku, Typ pocisku, Materiał, Wymiary). Wartości mogą pozostać w oryginale gdy to nazwy własne (V-Max, FMJ).",
    "product_image_indexes: indeksy (1-based) WYŁĄCZNIE zdjęć przedstawiających ten produkt. Pomiń logo, ikony UI, banery, miniatury innych produktów, zdjęcia kategorii.",
    "WAŻNE: jeżeli kandydatem zdjęcia jest INNY WARIANT tego samego producenta (inny kaliber, gramatura, model, rozmiar, kolor) — ODRZUĆ, nawet jeżeli marka i kształt się zgadzają. Dopasuj po kodzie / EAN / dokładnym wariancie z produktu klienta powyżej.",
    'Zwróć JSON: {"is_product_page": boolean, "product_description": string, "product_features": [{"key": string, "value": string}], "product_image_indexes": number[], "rejected_reason": string}.',
  ].join("\n");

  // Jeżeli markdown ma sekcję "## Description" / "## Opis" — do AI wysyłamy
  // tylko jej zawartość. Wtedy 3500-znakowe okno nie zostaje zjedzone przez
  // politykę wysyłki, recenzje ani "Related products".
  const focusedMarkdown = extractDescriptionSection(pageMarkdown) ?? pageMarkdown;

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
    focusedMarkdown.slice(0, 3500),
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
      .map((i) => cappedImages[i - 1])
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
      limit: 10,
      sources: ["web"],
      location: "Poland",
      lang: "pl",
      country: "pl",
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

  // 3) Filter out marketplaces / blacklist, dedup po hoście (max 1 URL/host), top 5.
  const seenHosts = new Set<string>();
  const filtered = allUrls
    .filter((u) => !isMarketplaceUrl(u, extraBlacklist))
    .filter((u) => {
      const h = (() => {
        try {
          return new URL(u).hostname.replace(/^www\./, "");
        } catch {
          return null;
        }
      })();
      if (!h || seenHosts.has(h)) return false;
      seenHosts.add(h);
      return true;
    })
    .slice(0, 5);
  await emit(ctx, {
    level: filtered.length ? "info" : "warn",
    message: `   ${nazwa} — ${allUrls.length} wyników, ${filtered.length} po filtrze`,
    details: { organic_urls: allUrls, filtered_urls: filtered },
  });
  if (!filtered.length) return;

  // 3b) Cache: pomiń URL-e już zescrape'owane w tym projekcie w ciągu 24h.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: cachedRows } = await supabaseAdmin
    .from("product_sources")
    .select("url, created_at")
    .eq("project_id", product.project_id)
    .in("url", filtered)
    .gte("created_at", dayAgo);
  const cachedUrls = new Set((cachedRows ?? []).map((r) => (r as { url: string }).url));

  // 4) Scrape each and upsert into product_sources.
  let scraped = 0;
  let cacheHits = 0;
  let totalImages = 0;
  let goodHits = 0;
  for (const url of filtered) {
    if (goodHits >= 3) {
      await emit(ctx, {
        level: "info",
        message: `   ⏩ ${nazwa} — early-exit po 3 dobrych trafieniach (pomijam pozostałe ${filtered.length - scraped - cacheHits} URL-i)`,
      });
      break;
    }
    if (cachedUrls.has(url)) {
      cacheHits++;
      goodHits++;
      const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      await emit(ctx, {
        level: "info",
        message: `   ♻️ ${host} — cache hit (<24h), pomijam scrape`,
        details: { url },
      });
      continue;
    }
    try {
      const scrape = (await firecrawl.scrape(url, {
        formats: ["markdown", "rawHtml"],
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
      if (filteredData.imageUrls.length > 0) goodHits++;
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
    message: `✅ ${nazwa} — zescrape'owano ${scraped}/${filtered.length} (${totalImages} zdjęć, ${cacheHits} z cache)`,
    details: { scraped, total: filtered.length, images: totalImages, cache_hits: cacheHits },
  });
}

// ---------------------------------------------------------------------------
// Run: Photo Tool — generate a packshot thumbnail + N lifestyle visualisations
// for a single `photo_products` row using Google Nano Banana Pro on fal.ai.
// ---------------------------------------------------------------------------

export async function runPhotoToolGenerate(photoProductId: string, ctx?: WorkerCtx): Promise<void> {
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) throw new Error("FAL_KEY nie jest skonfigurowany");

  const { data: prodRow } = await supabaseAdmin
    .from("photo_products" as never)
    .select("id, project_id, name, description, source_image_url, source_image_urls, generated_thumb_prompt, generated_lifestyle_prompt, prompt_source_hash")
    .eq("id", photoProductId)
    .maybeSingle();
  if (!prodRow) throw new Error("Photo product not found");
  const p = prodRow as unknown as {
    id: string;
    project_id: string;
    name: string | null;
    description: string | null;
    source_image_url: string;
    source_image_urls: string[] | null;
    generated_thumb_prompt: string | null;
    generated_lifestyle_prompt: string | null;
    prompt_source_hash: string | null;
  };

  const { data: projRow } = await supabaseAdmin
    .from("photo_projects" as never)
    .select("variants_per_product, style_prompt, requirements_pl")
    .eq("id", p.project_id)
    .maybeSingle();
  const proj = (projRow as { variants_per_product?: number; style_prompt?: string | null; requirements_pl?: string | null } | null) ?? {};
  const allSources = (p.source_image_urls && p.source_image_urls.length > 0)
    ? p.source_image_urls
    : [p.source_image_url];
  // Fixed output: always 1 thumbnail + 5 lifestyle visualisations,
  // regardless of how many source photos the user uploaded.
  const variants = 5;

  await supabaseAdmin
    .from("photo_products" as never)
    .update({ status: "PROCESSING", last_error: null } as never)
    .eq("id", p.id);

  const label = (p.name ?? p.id.slice(0, 8)).trim();
  await emit(ctx, {
    level: "info",
    message: `🖼  ${label} — ${allSources.length} źr. → 1 miniaturka + ${variants} wizualizacji (nano-banana-pro, 2K)`,
  });

  const productDesc = (p.description ?? "").trim();
  const productName = (p.name ?? "product").trim();
  const requirementsPl = (proj.requirements_pl ?? "").trim();
  const projectStyle = (proj.style_prompt ?? "").trim();

  // Build (or reuse cached) EN prompts translated from Polish requirements
  // via Gemini Pro. Cache is keyed on a hash of the inputs — if any of them
  // change, we regenerate the prompts.
  const sourceHashInput = [
    productName,
    productDesc,
    requirementsPl,
    projectStyle,
  ].join("\u0001");
  const sourceHash = await sha256Hex(sourceHashInput);

  let thumbPrompt: string;
  let lifePrompt: string;

  const cacheHit =
    p.prompt_source_hash === sourceHash &&
    p.generated_thumb_prompt &&
    p.generated_lifestyle_prompt;

  if (cacheHit) {
    thumbPrompt = p.generated_thumb_prompt as string;
    lifePrompt = p.generated_lifestyle_prompt as string;
    await emit(ctx, { level: "info", message: `   • prompty EN z cache` });
  } else {
    try {
      await emit(ctx, { level: "info", message: `   • buduję prompty EN z wytycznych PL (gemini-3.1-pro)…` });
      const built = await buildFalPromptsFromPolish({
        productName,
        productDesc,
        requirementsPl,
        projectStyle,
      });
      thumbPrompt = built.thumbnail_prompt;
      lifePrompt = built.lifestyle_prompt;
      await supabaseAdmin
        .from("photo_products" as never)
        .update({
          generated_thumb_prompt: thumbPrompt,
          generated_lifestyle_prompt: lifePrompt,
          prompt_source_hash: sourceHash,
        } as never)
        .eq("id", p.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await emit(ctx, { level: "warn", message: `   ⚠ AI prompt fallback: ${msg}` });
      const fb = fallbackPrompts({ productName, productDesc, requirementsPl, projectStyle });
      thumbPrompt = fb.thumbnail_prompt;
      lifePrompt = fb.lifestyle_prompt;
    }
  }

  const prepared: { url: string; path: string }[] = [];
  for (const u of allSources) {
    prepared.push(await prepareFalSource(p.id, u));
  }
  const referenceUrls = prepared.map((x) => x.url);
  try {
    await emit(ctx, { level: "info", message: `   • miniaturka…` });
    const thumbResp = await callFal(
      "fal-ai/nano-banana-pro/edit",
      {
        prompt: thumbPrompt,
        image_urls: referenceUrls,
        aspect_ratio: "1:1",
        resolution: "2K",
        output_format: "jpeg",
        num_images: 1,
      },
      FAL_KEY,
    );
    const thumbUrl = thumbResp.images?.[0]?.url;
    if (!thumbUrl) throw new Error("nano-banana-pro nie zwróciło miniaturki");
    const thumbBytes = await fetchBytes(thumbUrl);
    const thumbPath = `photo-tool/${p.project_id}/${p.id}/thumb.jpg`;
    const { error: tErr } = await supabaseAdmin.storage
      .from("regenerated-images")
      .upload(thumbPath, thumbBytes, { contentType: "image/jpeg", upsert: true });
    if (tErr) throw new Error(`Upload miniaturki: ${tErr.message}`);
    const { data: tPub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(thumbPath);
    const thumbnailPublic = `${tPub.publicUrl}?v=${Date.now()}`;
    await emit(ctx, { level: "success", message: `   ✔ miniaturka gotowa` });

    // 2) Lifestyle visualisations — realistic scenes with the same product.
    const lifestyleUrls: string[] = [];
    for (let i = 0; i < variants; i++) {
      await emit(ctx, { level: "info", message: `   • wizualizacja ${i + 1}/${variants}…` });
      try {
        const resp = await callFal(
          "fal-ai/nano-banana-pro/edit",
          {
            prompt: lifePrompt,
            image_urls: referenceUrls,
            aspect_ratio: "1:1",
            resolution: "2K",
            output_format: "jpeg",
            num_images: 1,
          },
          FAL_KEY,
        );
        const genUrl = resp.images?.[0]?.url;
        if (!genUrl) throw new Error("brak url");
        const bytes = await fetchBytes(genUrl);
        const path = `photo-tool/${p.project_id}/${p.id}/lifestyle-${i + 1}.jpg`;
        const { error: gErr } = await supabaseAdmin.storage
          .from("regenerated-images")
          .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (gErr) throw new Error(gErr.message);
        const { data: gPub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(path);
        lifestyleUrls.push(`${gPub.publicUrl}?v=${Date.now()}`);
        await emit(ctx, { level: "success", message: `   ✔ wizualizacja ${i + 1}` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await emit(ctx, { level: "warn", message: `   ⚠ wizualizacja ${i + 1}: ${msg}` });
      }
    }

    // Clean stale gallery slots above the requested count.
    for (let i = variants + 1; i <= 8; i++) {
      await supabaseAdmin.storage
        .from("regenerated-images")
        .remove([`photo-tool/${p.project_id}/${p.id}/lifestyle-${i}.jpg`])
        .catch(() => undefined);
    }

    const { error: dbErr } = await supabaseAdmin
      .from("photo_products" as never)
      .update({
        thumbnail_url: thumbnailPublic,
        lifestyle_urls: lifestyleUrls as never,
        status: "DONE",
        last_error: null,
      } as never)
      .eq("id", p.id);
    if (dbErr) throw new Error(dbErr.message);
    await emit(ctx, {
      level: "success",
      message: `✅ ${label} — gotowe (${lifestyleUrls.length}/${variants} wizualizacji)`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("photo_products" as never)
      .update({ status: "FAILED", last_error: msg } as never)
      .eq("id", p.id);
    throw e;
  } finally {
    await supabaseAdmin.storage
      .from("regenerated-images")
      .remove(prepared.map((x) => x.path))
      .catch(() => undefined);
  }
}

// -----------------------------------------------------------------------------
// Photo tool — per-image edit ("popraw to zdjęcie" po polsku)
// -----------------------------------------------------------------------------

async function buildFalEditPromptFromPolish(args: {
  productName: string;
  productDesc: string;
  originalPromptEn: string;
  requirementsPl: string;
}): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const system = [
    `You write a single English EDIT prompt for the fal-ai/nano-banana-pro/edit model.`,
    `The model receives ONE existing image (a previously generated photo) and must return an edited version of it.`,
    `Return JSON: { "edit_prompt": string }.`,
    ``,
    `Rules:`,
    `- Apply exactly the user's Polish correction. Translate it, don't invent new changes.`,
    `- Change ONLY what the user's correction requests. Everything else — product, logo, printed text, colours, materials, proportions, framing, lighting on the product — must stay pixel-identical to the input image.`,
    `- Preserve the product completely: shape, colour, labels, logos, materials, proportions — pixel-faithful to the input image.`,
    `- If the correction does NOT concern text on the product: never re-render, restyle or re-letter any printed text or logo — treat them as untouchable pixels. Do not invent, redraw or embellish any brand mark.`,
    `- If the correction DOES concern text on the product: quote the exact target text in double quotes, letter-for-letter (e.g. render label "NEW NAME" letter-for-letter). Never paraphrase.`,
    `- Keep the same aspect ratio (1:1) and overall composition unless the correction explicitly asks to reframe.`,
    `- Do not add watermarks, text overlays, price tags or store logos.`,
    `- If the correction affects the scene/background, include concrete photographic language consistent with the ORIGINAL PROMPT: camera angle, focal length + depth of field, light direction + colour temperature, plus "sharp, photorealistic, 4K commercial photography".`,
    `- If the correction is vague, be specific and concrete in English.`,
    `- Short, imperative sentences. No preamble, JSON only.`,
  ].join("\n");

  const user = [
    `PRODUCT NAME: ${args.productName || "(unnamed)"}`,
    `PRODUCT DESCRIPTION: ${args.productDesc || "(none)"}`,
    `ORIGINAL PROMPT USED TO CREATE THIS IMAGE (EN): ${args.originalPromptEn || "(unknown)"}`,
    `USER CORRECTION IN POLISH (translate & apply):`,
    args.requirementsPl || "(none)",
  ].join("\n");

  const res = (await callGatewayJson(apiKey, "google/gemini-3.1-pro-preview", [
    { role: "system", content: system },
    { role: "user", content: user },
  ])) as { edit_prompt?: string };

  const p = (res.edit_prompt ?? "").trim();
  if (!p) throw new Error("AI returned empty edit prompt");
  return p;
}

export async function runPhotoToolEditImage(
  photoProductId: string,
  args: { slot: "thumbnail" | "lifestyle"; lifestyleIndex: number; requirementsPl: string },
  ctx?: WorkerCtx,
): Promise<void> {
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) throw new Error("FAL_KEY nie jest skonfigurowany");

  const { data: prodRow } = await supabaseAdmin
    .from("photo_products" as never)
    .select(
      "id, project_id, name, description, thumbnail_url, lifestyle_urls, generated_thumb_prompt, generated_lifestyle_prompt",
    )
    .eq("id", photoProductId)
    .maybeSingle();
  if (!prodRow) throw new Error("Photo product not found");
  const p = prodRow as unknown as {
    id: string;
    project_id: string;
    name: string | null;
    description: string | null;
    thumbnail_url: string | null;
    lifestyle_urls: string[] | null;
    generated_thumb_prompt: string | null;
    generated_lifestyle_prompt: string | null;
  };

  const life = Array.isArray(p.lifestyle_urls) ? p.lifestyle_urls : [];
  const currentUrl =
    args.slot === "thumbnail" ? p.thumbnail_url : life[args.lifestyleIndex] ?? null;
  if (!currentUrl) throw new Error("Nie ma jeszcze zdjęcia do edycji w tym slocie");

  const label = (p.name ?? p.id.slice(0, 8)).trim();
  const slotLabel =
    args.slot === "thumbnail" ? "miniaturkę" : `wizualizację ${args.lifestyleIndex + 1}`;
  await emit(ctx, {
    level: "info",
    message: `✏️  ${label} — edytuję ${slotLabel} (nano-banana-pro, 2K)`,
  });

  const originalPromptEn =
    (args.slot === "thumbnail" ? p.generated_thumb_prompt : p.generated_lifestyle_prompt) ?? "";

  let editPrompt: string;
  try {
    await emit(ctx, { level: "info", message: `   • buduję prompt EN (gemini-3.1-pro)…` });
    editPrompt = await buildFalEditPromptFromPolish({
      productName: (p.name ?? "product").trim(),
      productDesc: (p.description ?? "").trim(),
      originalPromptEn,
      requirementsPl: args.requirementsPl.trim(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit(ctx, { level: "warn", message: `   ⚠ fallback promptu: ${msg}` });
    editPrompt = [
      `Edit the input image with this correction while keeping the exact same product (shape, labels, logos, colours, materials, proportions) and 1:1 framing:`,
      args.requirementsPl.trim() || "(brak wskazówek)",
      originalPromptEn ? `Original scene context (do not restate the whole scene, just preserve it): ${originalPromptEn}` : "",
    ].filter(Boolean).join(" ");
  }

  // Use the current generated image as the ONLY reference — this is an
  // in-place edit of the previous output.
  const prep = await prepareFalSource(p.id, currentUrl);
  try {
    await emit(ctx, { level: "info", message: `   • FAL edytuje…` });
    const callEdit = (prompt: string) =>
      callFal(
        "fal-ai/nano-banana-pro/edit",
        {
          prompt,
          image_urls: [prep.url],
          aspect_ratio: "1:1",
          resolution: "2K",
          output_format: "jpeg",
          num_images: 1,
        },
        FAL_KEY,
      );

    let resp: FalResp;
    try {
      resp = await callEdit(editPrompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // FAL 422 "did not generate the expected output" — usually the safety /
      // output filter tripped on the auto-built prompt. Retry once with a
      // minimal, neutral edit instruction derived directly from the user's PL
      // correction so we don't lose the whole job.
      if (/\b422\b/.test(msg)) {
        await emit(ctx, {
          level: "warn",
          message: `   ⚠ FAL 422 — ponawiam z uproszczonym promptem`,
        });
        const safe = [
          `Edit this product photo. Keep the product identical (shape, colours, labels, materials, proportions) and keep 1:1 framing.`,
          `Apply this correction: ${args.requirementsPl.trim() || "improve overall quality"}.`,
          `No text, no watermarks, no logos other than those already on the product.`,
        ].join(" ");
        resp = await callEdit(safe);
      } else {
        throw e;
      }
    }
    const outUrl = resp.images?.[0]?.url;
    if (!outUrl) throw new Error("nano-banana-pro nie zwróciło zdjęcia");
    const bytes = await fetchBytes(outUrl);

    const storagePath =
      args.slot === "thumbnail"
        ? `photo-tool/${p.project_id}/${p.id}/thumb.jpg`
        : `photo-tool/${p.project_id}/${p.id}/lifestyle-${args.lifestyleIndex + 1}.jpg`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("regenerated-images")
      .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`Upload: ${upErr.message}`);
    const { data: pub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(storagePath);
    const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;

    if (args.slot === "thumbnail") {
      const { error: dbErr } = await supabaseAdmin
        .from("photo_products" as never)
        .update({ thumbnail_url: publicUrl } as never)
        .eq("id", p.id);
      if (dbErr) throw new Error(dbErr.message);
    } else {
      const nextLife = [...life];
      nextLife[args.lifestyleIndex] = publicUrl;
      const { error: dbErr } = await supabaseAdmin
        .from("photo_products" as never)
        .update({ lifestyle_urls: nextLife as never } as never)
        .eq("id", p.id);
      if (dbErr) throw new Error(dbErr.message);
    }

    await emit(ctx, { level: "success", message: `✅ ${label} — ${slotLabel} zaktualizowana` });
  } finally {
    await supabaseAdmin.storage
      .from("regenerated-images")
      .remove([prep.path])
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Run: PIM Visualizations — generate N lifestyle visualisations for a
// source_product using its final main image and append them to the
// enrichments.ai_gallery_urls. Reuses the /photo prompt builder.
// ---------------------------------------------------------------------------

export async function runPimVisualization(
  productId: string,
  ctx?: WorkerCtx,
  payload?: {
    count?: number;
    requirementsPl?: string;
    stylePrompt?: string;
    targetResolution?: number;
  },
): Promise<{ complete: boolean }> {
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) throw new Error("FAL_KEY nie jest skonfigurowany");

  const count = Math.max(0, Math.min(8, Math.floor(payload?.count ?? 0)));
  if (count === 0) {
    await emit(ctx, { level: "info", message: `⏭  ${productId.slice(0, 8)} — 0 wizualizacji, pomijam` });
    return { complete: true };
  }
  const targetResolution = payload?.targetResolution === 4096 ? "4K" : "2K";
  const requirementsPl = (payload?.requirementsPl ?? "").trim();
  const projectStyle = (payload?.stylePrompt ?? "").trim();

  const { data: product } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, raw")
    .eq("id", productId)
    .single();
  if (!product) throw new Error("Product not found");
  const productName = ((product as { nazwa?: string | null }).nazwa ?? "").trim();
  const productDesc = (((product as { raw?: { opis?: string | null; description?: string | null } | null }).raw?.opis
    ?? (product as { raw?: { description?: string | null } | null }).raw?.description
    ?? "") as string).trim();

  const { data: enrichment } = await supabaseAdmin
    .from("enrichments")
    .select("id, picked_urls, regenerated_main_image, pinned_main_url, ai_gallery_urls, golden_name, golden_description")
    .eq("source_product_id", productId)
    .maybeSingle();
  if (!enrichment) throw new Error("Brak enrichment");
  const e = enrichment as unknown as {
    id: string;
    picked_urls: string[] | null;
    regenerated_main_image: string | null;
    pinned_main_url: string | null;
    ai_gallery_urls: string[] | null;
    golden_name: string | null;
    golden_description: string | null;
  };

  // Pick main source image: pinned → regenerated (skip sentinel) → picked[0].
  const regen = e.regenerated_main_image && e.regenerated_main_image !== "__imported__"
    ? e.regenerated_main_image
    : null;
  const mainUrl = e.pinned_main_url || regen || (e.picked_urls?.[0] ?? null);
  if (!mainUrl) throw new Error("Brak zdjęcia głównego — najpierw uruchom regenerację lub dopasuj źródła");

  const label = (productName || productId.slice(0, 8)).trim();
  await emit(ctx, {
    level: "info",
    message: `🎨 ${label} — ${count} wizualizacji (nano-banana-pro, ${targetResolution})`,
  });

  const jobPayload = (ctx?.bulkPayload ?? {}) as Record<string, unknown>;
  const progress = ((jobPayload.visualizationProgress ?? {}) as PimVisualizationProgress) || {};
  let productsProgress = progress.products ?? {};
  let slotState: PimVisualizationSlot = productsProgress[productId] ?? { slot: 0 };
  slotState.slot = Math.max(0, Math.min(count, Math.floor(slotState.slot || 0)));

  let lifePrompt = (progress.prompts?.[productId] ?? "").trim();
  const saveProgress = async (next: PimVisualizationSlot | null) => {
    if (!ctx?.bulkJobId) return;
    const nextProducts = { ...productsProgress };
    const nextPrompts = { ...(progress.prompts ?? {}) };
    if (next) {
      nextProducts[productId] = next;
      if (lifePrompt) nextPrompts[productId] = lifePrompt;
    } else {
      delete nextProducts[productId];
      delete nextPrompts[productId];
    }
    productsProgress = nextProducts;
    const nextPayload = {
      ...jobPayload,
      visualizationProgress: { ...progress, products: nextProducts, prompts: nextPrompts },
    };
    await supabaseAdmin
      .from("bulk_jobs" as never)
      .update({ payload: nextPayload as never } as never)
      .eq("id", ctx.bulkJobId);
  };

  // Build EN prompt from Polish requirements. Prefer golden record if present.
  const nameForPrompt = e.golden_name?.trim() || productName || "product";
  const descForPrompt = e.golden_description?.trim() || productDesc;
  if (!lifePrompt) {
    try {
      await emit(ctx, { level: "info", message: `   • buduję prompt EN (gemini-3.1-pro)…` });
      const built = await buildFalPromptsFromPolish({
        productName: nameForPrompt,
        productDesc: descForPrompt,
        requirementsPl,
        projectStyle,
      });
      lifePrompt = built.lifestyle_prompt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await emit(ctx, { level: "warn", message: `   ⚠ AI prompt fallback: ${msg}` });
      const fb = fallbackPrompts({
        productName: nameForPrompt,
        productDesc: descForPrompt,
        requirementsPl,
        projectStyle,
      });
      lifePrompt = fb.lifestyle_prompt;
    }
    await saveProgress(slotState);
    if (ctx?.deadline && Date.now() > ctx.deadline - 8_000) {
      await emit(ctx, { level: "info", message: `   • prompt gotowy — render wystartuje w następnym przebiegu` });
      return { complete: false };
    }
  }

  const appendVisualization = async (url: string, slot: number) => {
    const bytes = await fetchBytes(url);
    const stamp = Date.now();
    const path = `visualizations/${e.id}-${stamp}-${slot + 1}.jpg`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("regenerated-images")
      .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: pub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(path);
    const publicUrl = `${pub.publicUrl}?v=${stamp}`;

    const { data: fresh, error: readErr } = await supabaseAdmin
      .from("enrichments")
      .select("ai_gallery_urls")
      .eq("id", e.id)
      .single();
    if (readErr) throw new Error(readErr.message);
    const existing = Array.isArray((fresh as { ai_gallery_urls?: unknown }).ai_gallery_urls)
      ? ((fresh as { ai_gallery_urls?: string[] }).ai_gallery_urls ?? [])
      : [];
    const merged = existing.includes(publicUrl) ? existing : [...existing, publicUrl];
    const { error: dbErr } = await supabaseAdmin
      .from("enrichments")
      .update({ ai_gallery_urls: merged as never } as never)
      .eq("id", e.id);
    if (dbErr) throw new Error(dbErr.message);
    await emit(ctx, { level: "success", message: `   ✔ odebrano z FAL, upload OK, dopisano do galerii (${slot + 1}/${count})` });
  };

  const isRefusal = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const status = errorStatus(err);
    return status === 422 || /\b422\b|could not generate|given prompts and images/i.test(msg);
  };

  const buildRequest = (mode: PimVisualizationSlot["mode"]) => {
    if (mode === "safe-edit") {
      const safePrompt = [
        `Photorealistic square 1:1 product photo of "${nameForPrompt}".`,
        `Realistic in-use lifestyle scene, natural daylight, tasteful props, shallow depth of field.`,
        `Keep product, logo, printed text, colours, materials and proportions EXACTLY the same as the reference. Do not change the product's colours. Change only the background and scene.`,
        projectStyle ? `Scene style: ${projectStyle}.` : "",
        `Sharp, no motion blur, no text overlays, no watermarks.`,
      ].filter(Boolean).join(" ");
      return {
        path: "fal-ai/nano-banana-pro/edit",
        body: {
          prompt: safePrompt,
          image_urls: [] as string[],
          aspect_ratio: "1:1",
          resolution: targetResolution,
          output_format: "jpeg",
          num_images: 1,
        },
      };
    }
    if (mode === "generate") {
      const descBrief = (descForPrompt || "").replace(/\s+/g, " ").trim().slice(0, 600);
      const genPrompt = [
        `Photorealistic square 1:1 product photo of "${nameForPrompt}".`,
        descBrief ? `Product context: ${descBrief}.` : "",
        `Realistic in-use lifestyle scene, natural daylight, tasteful props, shallow depth of field, 85mm lens.`,
        projectStyle ? `Scene style: ${projectStyle}.` : "",
        `Sharp focus, no motion blur, no text overlays, no watermarks, no logos.`,
      ].filter(Boolean).join(" ");
      return {
        path: "fal-ai/nano-banana-pro",
        body: {
          prompt: genPrompt,
          aspect_ratio: "1:1",
          resolution: targetResolution,
          output_format: "jpeg",
          num_images: 1,
        },
      };
    }
    return {
      path: "fal-ai/nano-banana-pro/edit",
      body: {
        prompt: lifePrompt,
        image_urls: [] as string[],
        aspect_ratio: "1:1",
        resolution: targetResolution,
        output_format: "jpeg",
        num_images: 1,
      },
    };
  };

  const cleanupSource = async (state: PimVisualizationSlot) => {
    if (!state.sourcePath) return;
    await supabaseAdmin.storage
      .from("regenerated-images")
      .remove([state.sourcePath])
      .catch(() => undefined);
  };

  let lastFalErr: string | null = null;
  try {
    while (slotState.slot < count) {
      if (ctx?.deadline && Date.now() > ctx.deadline - 4_000) {
        await saveProgress(slotState);
        await emit(ctx, { level: "info", message: `   • kontynuacja w następnym przebiegu (${slotState.slot}/${count})` });
        return { complete: false };
      }

      const slot = slotState.slot;
      await emit(ctx, { level: "info", message: `   • wizualizacja ${slot + 1}/${count}…` });
      if (!slotState.mode) slotState = { ...slotState, mode: "edit" };

      if (!slotState.request) {
        if ((slotState.mode === "edit" || slotState.mode === "safe-edit") && !slotState.sourceUrl) {
          const source = await prepareFalSource(e.id, mainUrl);
          slotState = { ...slotState, sourceUrl: source.url, sourcePath: source.path };
        }
        const req = buildRequest(slotState.mode);
        const body = req.body as { image_urls?: string[] };
        if (body.image_urls) body.image_urls = slotState.sourceUrl ? [slotState.sourceUrl] : [];
        try {
          const queued = await submitFalQueue(req.path, req.body, FAL_KEY);
          slotState = { ...slotState, request: queued };
          await saveProgress(slotState);
          await emit(ctx, { level: "info", message: `   • FAL przyjął zadanie ${slot + 1}/${count} (${slotState.mode})` });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastFalErr = msg;
          if (isRefusal(err) && slotState.mode === "edit") {
            await emit(ctx, { level: "warn", message: `   ⚠ FAL 422 — próbuję z uproszczonym promptem` });
            await cleanupSource(slotState);
            slotState = { slot, mode: "safe-edit", lastError: msg };
            await saveProgress(slotState);
            continue;
          }
          if (isRefusal(err) && slotState.mode === "safe-edit") {
            await emit(ctx, { level: "warn", message: `   ⚠ FAL 422 przy edycji — próbuję generowania bez referencji` });
            await cleanupSource(slotState);
            slotState = { slot, mode: "generate", lastError: msg };
            await saveProgress(slotState);
            continue;
          }
          if (isRefusal(err) && slotState.mode === "generate") {
            lastFalErr = "FAL odrzucił zarówno edycję jak i generowanie od zera (422) — najpewniej treść uznana za wrażliwą";
          }
          await emit(ctx, { level: "warn", message: `   ⚠ wizualizacja ${slot + 1}: ${lastFalErr.slice(0, 240)}` });
          await cleanupSource(slotState);
          slotState = { slot: slot + 1 };
          await saveProgress(slotState);
          continue;
        }
      }

      try {
        let queueResult: FalQueueStatus | null = null;
        while (slotState.request) {
          queueResult = await readFalQueue(slotState.request, FAL_KEY);
          if (!queueResult.pending) break;
          if (!ctx?.deadline || Date.now() > ctx.deadline - 6_000) {
            await saveProgress(slotState);
            await emit(ctx, { level: "info", message: `   • FAL nadal renderuje — sprawdzę w następnym przebiegu` });
            return { complete: false };
          }
          await wait(1_500);
        }
        if (!queueResult || queueResult.pending) return { complete: false };
        const genUrl = queueResult.response.images?.[0]?.url;
        if (!genUrl) throw new Error("brak url");
        await appendVisualization(genUrl, slot);
        await cleanupSource(slotState);
        slotState = { slot: slot + 1 };
        await saveProgress(slotState.slot < count ? slotState : null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastFalErr = msg;
        if (isRefusal(err) && slotState.mode === "edit") {
          await emit(ctx, { level: "warn", message: `   ⚠ FAL 422 — próbuję z uproszczonym promptem` });
          await cleanupSource(slotState);
          slotState = { slot, mode: "safe-edit", lastError: msg };
          await saveProgress(slotState);
          continue;
        }
        if (isRefusal(err) && slotState.mode === "safe-edit") {
          await emit(ctx, { level: "warn", message: `   ⚠ FAL 422 przy edycji — próbuję generowania bez referencji` });
          await cleanupSource(slotState);
          slotState = { slot, mode: "generate", lastError: msg };
          await saveProgress(slotState);
          continue;
        }
        if (isRefusal(err) && slotState.mode === "generate") {
          lastFalErr = "FAL odrzucił zarówno edycję jak i generowanie od zera (422) — najpewniej treść uznana za wrażliwą";
        }
        await emit(ctx, { level: "warn", message: `   ⚠ wizualizacja ${slot + 1}: ${lastFalErr.slice(0, 240)}` });
        await cleanupSource(slotState);
        slotState = { slot: slot + 1 };
        await saveProgress(slotState.slot < count ? slotState : null);
      }
    }
  } finally {
    // Source files for in-flight FAL queue jobs are intentionally kept until
    // the request is polled to completion; cleanup happens after each slot.
  }

  await saveProgress(null);

  const { data: finalEn } = await supabaseAdmin
    .from("enrichments")
    .select("ai_gallery_urls")
    .eq("id", e.id)
    .single();
  const finalGallery = Array.isArray((finalEn as { ai_gallery_urls?: unknown } | null)?.ai_gallery_urls)
    ? ((finalEn as { ai_gallery_urls?: string[] }).ai_gallery_urls ?? [])
    : [];
  const initialCount = Array.isArray(e.ai_gallery_urls) ? e.ai_gallery_urls.length : 0;
  const added = Math.max(0, finalGallery.length - initialCount);

  await emit(ctx, {
    level: "success",
    message: `✅ ${label} — ${added}/${count} wizualizacji dopisanych do galerii`,
  });

  // If nothing was generated, surface the failure so the bulk job's
  // failed_count/last_error reflect reality. Otherwise the user sees a
  // "COMPLETED" job with no visualizations and no explanation.
  if (added === 0) {
    throw new Error(
      `FAL nie wygenerował żadnej wizualizacji dla „${label}". ${lastFalErr ? `Ostatni błąd: ${lastFalErr.slice(0, 200)}` : ""}`.trim(),
    );
  }
  return { complete: true };
}

// ---------------------------------------------------------------------------
// runPimAllegroDescription — generuje sprzedażowy opis HTML pod Allegro
// dla pojedynczego produktu (używany w bulk_jobs PIM_ALLEGRO_DESCRIPTION).
// ---------------------------------------------------------------------------

export async function runPimAllegroDescription(productId: string, ctx?: WorkerCtx): Promise<void> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const { data: product, error: pErr } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, kod, ean")
    .eq("id", productId)
    .single();
  if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

  const { data: enrichment } = await supabaseAdmin
    .from("enrichments")
    .select("*")
    .eq("source_product_id", product.id)
    .maybeSingle();
  if (!enrichment) throw new Error("Brak wzbogacenia — najpierw wygeneruj złoty rekord.");

  const en = enrichment as typeof enrichment & {
    golden_name?: string | null;
    golden_description?: string | null;
    golden_features?: Array<{ key: string; value: string }> | null;
    golden_seo_keywords?: string[] | null;
    golden_meta_description?: string | null;
  };
  const goldenName = (en.golden_name ?? product.nazwa ?? "").trim();
  const goldenDescription = (en.golden_description ?? "").trim();
  const features = Array.isArray(en.golden_features) ? en.golden_features : [];
  const keywords = Array.isArray(en.golden_seo_keywords) ? en.golden_seo_keywords : [];
  const meta = (en.golden_meta_description ?? "").trim();

  if (!goldenName) throw new Error("Brak nazwy — wygeneruj najpierw złoty rekord.");

  await emit(ctx, { level: "info", message: `📝 Allegro: generuję opis dla „${goldenName}"…` });

  const userPrompt = [
    `NAZWA PRODUKTU: ${goldenName}`,
    `KOD: ${product.kod ?? ""}`,
    `EAN: ${product.ean ?? ""}`,
    "",
    "META DESCRIPTION (dla kontekstu):",
    meta || "(brak)",
    "",
    "OPIS ZŁOTEGO REKORDU (HTML, źródło faktów):",
    goldenDescription || "(brak)",
    "",
    "CECHY / PARAMETRY:",
    features.length ? features.map((f) => `- ${f.key}: ${f.value}`).join("\n") : "(brak)",
    "",
    "FRAZY KLUCZOWE:",
    keywords.length ? keywords.join(", ") : "(brak)",
    "",
    'Wygeneruj JSON {"html": string} — kompletny, sprzedażowy opis Allegro zgodny z system promptem. Bierz fakty wyłącznie z podanych danych.',
  ].join("\n");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.5",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ALLEGRO_DESCRIPTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new Error("Model nie zwrócił poprawnego JSON"); }
  const shape = z.object({ html: z.string().min(1).max(60000) }).parse(parsed);
  const html = sanitizeAllegroDescriptionHtml(shape.html);
  if (!html) throw new Error("Model zwrócił pusty opis");

  const { error: upErr } = await supabaseAdmin
    .from("enrichments")
    .update({
      allegro_description: html,
      allegro_generated_at: new Date().toISOString(),
    } as never)
    .eq("id", enrichment.id);
  if (upErr) throw new Error(upErr.message);

  await emit(ctx, { level: "success", message: `✅ Allegro: opis zapisany (${html.length} znaków)` });
}
