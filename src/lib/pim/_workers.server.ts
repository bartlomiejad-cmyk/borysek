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
  dedupeKeywords as dedupeKeywordsShared,
  GOLDEN_SEO_SYSTEM_PROMPT,
  sanitizeGoldenDescriptionHtml,
  ALLEGRO_DESCRIPTION_SYSTEM_PROMPT,
  sanitizeAllegroDescriptionHtml,
  buildClientGuidelinesBlock,
  finalizeMetaDescription,
  SHORTEN_META_SYSTEM_PROMPT,
} from "./seo";
import Firecrawl from "@mendable/firecrawl-js";
import { buildQueryVariants, normalizeUrlForDedup, stripTrackingParams, type QueryStrategy } from "./query-variants";
import { advancePipelineStatus } from "./pipeline-status";
import { logProductEvent } from "./product-events.server";
import { runSerpSearch, type SerpBucket, type SerpMeta, type SerpResult } from "./apify.server";
import { preselectSerpResults } from "./serp-preselect.server";
import {
  runThumbnailQc,
  buildCorrectionSentence,
  qcScore,
  qcAllPass,
  type ThumbnailQcResult,
  type ThumbnailQcPersisted,
  runVisualizationQc,
  buildVisualizationCorrectionSentence,
  visualizationQcScore,
  visualizationQcPassed,
  runReferenceConsistencyCheck,
  type VisualizationQcResult,
  type VisualizationQcPersisted,
} from "./thumbnail-qc";
import {
  auditChecks,
  AUDIT_SYSTEM_PROMPT,
  buildAuditUserPrompt,
  combineAuditVerdict,
  verdictToReviewStatus,
  visibleText,
  type AuditLlmResult,
  type AuditResult,
} from "./audit";

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
  data_sufficiency: z.enum(["full", "partial", "poor"]).optional(),
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

/**
 * Per-product visualization scene analysis via Gemini Vision. Plain server
 * helper (no createServerFn wrapper) so bulk workers can call it directly.
 * Returns Polish {style, requirements} that feed buildFalPromptsFromPolish.
 * Callers layer client_guidelines and project constraints on top separately.
 */
export async function analyzeVisualizationSceneForProduct(args: {
  productName: string;
  featuresText: string;
  imageUrls: string[]; // main first, max 4, must be publicly fetchable
  projectConstraintsPl?: string; // optional PL text; overrides scene choices
}): Promise<{
  style: string;
  requirements: string;
  used: number;
  has_text: boolean;
  color_anchor_en: string;
}> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
  const urls = args.imageUrls.filter(Boolean).slice(0, 4);
  if (!urls.length) throw new Error("Brak zdjęć do analizy");

  const system = [
    "Jesteś dyrektorem artystycznym fotografii lifestyle e-commerce.",
    "Analizujesz załączone zdjęcia produktu i piszesz po polsku spersonalizowany prompt do wizualizacji lifestyle (produkt w scenie użytkowej).",
    "Zaobserwuj typ produktu, kategorię, materiał, kolor, kontekst użycia.",
    'Zwróć wyłącznie JSON: {"style":"...", "requirements":"...", "has_text": boolean, "color_anchor_en":"..."}.',
    "- style (80–220 znaków): scena/otoczenie pasujące do TEGO konkretnego produktu — powierzchnia, tło, pora dnia, nastrój, charakter światła. Bez ludzi z twarzą, bez marek, bez cen.",
    "- requirements (140–320 znaków): kąt kamery, głębia ostrości, kierunek/temperatura światła, kompozycja, rekwizyty. Dodaj: zachowaj kolor, logo, etykiety i proporcje produktu dokładnie jak w źródle.",
    '- has_text: true jeśli na produkcie widać czytelne napisy/logo/etykiety, false gdy produkt jest "gładki" (np. jednokolorowa taśma, folia, karton bez druku).',
    '- color_anchor_en (60–180 znaków, PO ANGIELSKU): konkretne, nazwane kolory najważniejszych powierzchni produktu i wnętrza/rdzenia (np. "outer wound surface uniformly bright green, side face green, core light beige/white"). Kluczowe zwłaszcza dla produktów bez tekstu — zastępuje ogólne "preserve colours".',
    "Bez markdown, bez cudzysłowów wokół całości, bez komentarza. Tylko surowy JSON.",
  ].join("\n");

  const constraintsBlock = (args.projectConstraintsPl ?? "").trim();
  const userText = [
    `Nazwa produktu: "${args.productName || "(bez nazwy)"}"`,
    args.featuresText ? `Cechy: ${args.featuresText}` : "",
    constraintsBlock
      ? `OGRANICZENIA PROJEKTU (nadrzędne wobec Twoich pomysłów na scenę):\n${constraintsBlock}`
      : "",
    `Przeanalizuj ${urls.length} zdjęci${urls.length === 1 ? "e" : "a"} poniżej i zwróć JSON.`,
  ].filter(Boolean).join("\n");

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: userText }];
  for (const u of urls) content.push({ type: "image_url", image_url: { url: u } });

  const parsed = (await callGatewayJson(apiKey, "google/gemini-2.5-pro", [
    { role: "system", content: system },
    { role: "user", content },
  ])) as {
    style?: unknown;
    requirements?: unknown;
    has_text?: unknown;
    color_anchor_en?: unknown;
  };
  const style = typeof parsed.style === "string" ? parsed.style.trim() : "";
  const requirements = typeof parsed.requirements === "string" ? parsed.requirements.trim() : "";
  const has_text = typeof parsed.has_text === "boolean" ? parsed.has_text : true;
  const color_anchor_en =
    typeof parsed.color_anchor_en === "string" ? parsed.color_anchor_en.trim() : "";
  if (!style || !requirements) throw new Error("Model nie zwrócił pełnego wyniku analizy");
  return { style, requirements, used: urls.length, has_text, color_anchor_en };
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
    `FRAMING: Square 1:1, product centered, fills 70-80% of the frame in BOTH width and height; longest edge ~75% of the canvas.`,
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
  clientGuidelines?: string;
  productNotes?: string;
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
    `- Soft realistic contact shadow. Product fills 70–80% of the frame in BOTH width and height; longest edge ~75% of the canvas.`,
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

  const guidelinesBlock = buildClientGuidelinesBlock(
    args.clientGuidelines ?? "",
    args.productNotes ?? "",
  );
  const userWithGuidelines = guidelinesBlock ? `${user}\n\n${guidelinesBlock}` : user;

  const res = await callGatewayJson(apiKey, "google/gemini-3.1-pro-preview", [
    { role: "system", content: system },
    { role: "user", content: userWithGuidelines },
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

// ---------------------------------------------------------------------------
// Deterministic pure-white background enforcement for product thumbnails.
//
// Even with a very strict prompt, generative models leave a faint beige / gray
// cast under the product. To guarantee mathematically flat #FFFFFF, we:
//   1. run the FAL output through a background-removal model → RGBA PNG,
//   2. composite RGBA over solid #FFFFFF in pure JS (upng-js, Worker-safe),
//   3. return the flattened PNG bytes.
// Only used for thumbnails / packshots — never for lifestyle scenes.
// ---------------------------------------------------------------------------
export async function flattenToWhiteBackground(
  publicImageUrl: string,
  apiKey: string,
): Promise<Uint8Array> {
  // Step 1 — background removal. bria/background/remove returns { image: { url } }
  // with a transparent PNG. If it errors, fall back to imageutils/rembg.
  let cutoutUrl: string | undefined;
  try {
    const removed = await callFal(
      "fal-ai/bria/background/remove",
      { image_url: publicImageUrl },
      apiKey,
    );
    cutoutUrl = removed.image?.url ?? removed.images?.[0]?.url;
  } catch (e) {
    console.warn("bria background/remove failed, falling back to rembg", e);
  }
  if (!cutoutUrl) {
    const removed2 = await callFal(
      "fal-ai/imageutils/rembg",
      { image_url: publicImageUrl },
      apiKey,
    );
    cutoutUrl = removed2.image?.url ?? removed2.images?.[0]?.url;
  }
  if (!cutoutUrl) throw new Error("Usuwanie tła nie zwróciło obrazu");

  const cutoutBytes = await fetchBytes(cutoutUrl);

  // Step 2 — decode PNG, composite over #FFFFFF, re-encode.
  const UPNG = (await import("upng-js")).default as typeof import("upng-js");
  const ab: ArrayBuffer = cutoutBytes.buffer.slice(
    cutoutBytes.byteOffset,
    cutoutBytes.byteOffset + cutoutBytes.byteLength,
  ) as ArrayBuffer;
  const decoded = UPNG.decode(ab);
  const width = decoded.width;
  const height = decoded.height;
  const rgbaBuffers = UPNG.toRGBA8(decoded);
  const src = new Uint8Array(rgbaBuffers[0]);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    const a = src[i + 3] / 255;
    const inv = 1 - a;
    out[i] = Math.round(src[i] * a + 255 * inv);
    out[i + 1] = Math.round(src[i + 1] * a + 255 * inv);
    out[i + 2] = Math.round(src[i + 2] * a + 255 * inv);
    out[i + 3] = 255;
  }
  // cnum=0 → lossless PNG. Buffer size ~2–4 MB for 2K/2.5K squares.
  const encoded = UPNG.encode([out.buffer as ArrayBuffer], width, height, 0);
  return new Uint8Array(encoded);
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
  // Multi-reference (new — additive; sourceUrl/Path kept for BC / single-slot fallback):
  sourceUrls?: string[];
  sourcePaths?: string[];
  // Retry-with-Vision-QC state (per slot, resets when moving to next slot):
  attempts?: number;
  bestUrl?: string;
  bestQc?: VisualizationQcResult;
  bestScore?: number;
  extraPromptSuffix?: string;
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
    .select("id, project_id, nazwa, kod, ean, raw, product_notes, manual_lock, matching_mode")
    .eq("id", productId)
    .single();
  if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");
  if ((product as { manual_lock?: boolean }).manual_lock) {
    await emit(ctx, {
      level: "warn",
      message: `⏭ Pominięte (zablokowane): ${product.nazwa ?? productId} — złoty rekord`,
    });
    return;
  }
  await emit(ctx, { level: "info", message: `✍️  ${product.nazwa ?? productId} — generuję opis` });

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("custom_prompt, blacklist, settings")
    .eq("id", product.project_id)
    .single();
  const customPrompt = project?.custom_prompt ?? "";
  const blacklist = (project?.blacklist as string[] | null) ?? [];
  const clientGuidelines =
    ((project?.settings as { client_guidelines?: string } | null)?.client_guidelines ?? "") || "";
  const productNotes = (product as { product_notes?: string | null }).product_notes ?? "";
  const guidelinesBlock = buildClientGuidelinesBlock(clientGuidelines, productNotes);

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

  const isCompatibleMode =
    ((product as { matching_mode?: string | null }).matching_mode === "compatible");
  const compatibilityLine = isCompatibleMode
    ? "PRODUKT TYPU ZAMIENNIK/AKCESORIUM: opis może czerpać parametry techniczne i listy kompatybilności ze źródeł równoważnych, ale NIE przenoś nazw marek zamienników innych sklepów do nazwy i opisu; nazwą wiodącą jest nazwa z bazy klienta."
    : "";

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
    guidelinesBlock ? guidelinesBlock + "\n" : "",
    compatibilityLine,
    'Wygeneruj JSON {"name", "slug", "description", "meta_description", "seo_keywords", "features"} zgodnie z regułami SEO opisanymi w system prompt.',
  ].filter(Boolean).join("\n");

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
    const rawMeta = sanitizeStr(out.meta_description ?? "");
    const metaDescription = await finalizeMetaDescription(rawMeta, async (text) => {
      const shortened = await callGatewayJson(apiKey, GOLDEN_MODEL, [
        { role: "system", content: SHORTEN_META_SYSTEM_PROMPT },
        { role: "user", content: text },
      ]);
      return (shortened as { meta_description?: string }).meta_description ?? "";
    });
    const dataSufficiency = out.data_sufficiency ?? null;
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
      data_sufficiency: dataSufficiency,
    };
    if (shouldWriteFeatures) updatePayload.golden_features = newFeatures;

    const { error } = await supabaseAdmin
      .from("enrichments")
      .update(updatePayload as never)
      .eq("id", enrichment.id);
    if (error) throw new Error(error.message);
    // Regeneration invalidates a prior manual approval — demote APPROVED to
    // NEEDS_REVIEW so reviewers re-check the new golden record.
    try {
      const { data: prow } = await supabaseAdmin
        .from("source_products")
        .select("review_status")
        .eq("id", product.id)
        .maybeSingle();
      const cur = (prow as { review_status?: string | null } | null)?.review_status ?? null;
      if (cur === "APPROVED") {
        await supabaseAdmin
          .from("source_products")
          .update({
            review_status: "NEEDS_REVIEW",
            approved_at: null,
            approved_by: null,
          } as never)
          .eq("id", product.id);
        await emit(ctx, {
          level: "info",
          message: `[review-reset] ${product.nazwa ?? productId} — zatwierdzenie cofnięte po regeneracji`,
        });
      }
    } catch { /* review-reset is best-effort */ }
    await emit(ctx, { level: "success", message: `✅ ${product.nazwa ?? productId} — opis wygenerowany` });
    await advancePipelineStatus(supabaseAdmin as never, product.id, "GOLDEN_READY");
    await logProductEvent(supabaseAdmin, {
      projectId: product.project_id,
      productId: product.id,
      kind: "golden_generated",
      message: `Wygenerowano złoty rekord (${dataSufficiency ?? "n/d"})`,
      meta: { model: GOLDEN_MODEL, data_sufficiency: dataSufficiency ?? null },
    });
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
    .select("id, project_id, manual_lock")
    .eq("id", productId)
    .single();
  if (!product) throw new Error("Product not found");
  const productLocked = !!(product as { manual_lock?: boolean }).manual_lock;

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
    // -----------------------------------------------------------------------
    // Generate the packshot with up to 3 attempts (initial + 2 QC retries).
    // Each attempt uploads to a candidate path so Gemini can fetch the URL,
    // then Vision compares against the source reference. Best attempt wins;
    // tiebreak by `bg_white`. When QC still fails after retries AND a previous
    // main image exists, we do NOT auto-replace it — the candidate is kept
    // for the user to accept / reject from the editor UI.
    // -----------------------------------------------------------------------
    const referenceForQc = mainSourceUrls[0];
    type Attempt = { bytes: Uint8Array; publicUrl: string; qc: ThumbnailQcResult };
    let best: Attempt | null = null;
    let qcSkipped = false;
    let currentPrompt = mainPrompt;
    const candidatePath = `${enrichment.id}.candidate.png`;
    const maxAttempts = 3;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      const mainResp = await callFal(
        "fal-ai/bytedance/seedream/v4/edit",
        {
          image_urls: preparedMain.map((p) => p.url),
          prompt: currentPrompt,
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

      const mainBytes = await flattenToWhiteBackground(mainUrl, FAL_KEY);
      const { error: candErr } = await supabaseAdmin.storage
        .from("regenerated-images")
        .upload(candidatePath, mainBytes, { contentType: "image/png", upsert: true });
      if (candErr) throw new Error(`Upload kandydata: ${candErr.message}`);
      const { data: cPub } = supabaseAdmin.storage
        .from("regenerated-images")
        .getPublicUrl(candidatePath);
      const candidatePublicUrl = `${cPub.publicUrl}?v=${Date.now()}`;

      let qc: ThumbnailQcResult;
      try {
        qc = await runThumbnailQc(apiKey, referenceForQc, candidatePublicUrl);
      } catch (e) {
        qcSkipped = true;
        qc = {
          bg_white: true,
          product_intact: true,
          framing_ok: true,
          issues: [`QC pominięte: ${e instanceof Error ? e.message : String(e)}`],
        };
      }
      const current: Attempt = { bytes: mainBytes, publicUrl: candidatePublicUrl, qc };
      if (
        !best ||
        qcScore(current.qc) > qcScore(best.qc) ||
        (qcScore(current.qc) === qcScore(best.qc) && current.qc.bg_white && !best.qc.bg_white)
      ) {
        best = current;
      }
      if (qcSkipped || qcAllPass(qc)) break;
      if (attempt < maxAttempts) {
        currentPrompt = `${mainPrompt}\n\n${buildCorrectionSentence(qc)}`;
        await emit(ctx, {
          level: "warn",
          message: `🔁 Miniatura ${productId.slice(0, 8)} nie przeszła QC (próba ${attempt}: ${qc.issues.slice(0, 2).join("; ") || "detale poniżej progu"}) — poprawiam prompt`,
        });
      }
    }
    if (!best) throw new Error("Nie udało się wygenerować miniatury");

    const passed = qcSkipped || qcAllPass(best.qc);
    const mainPath = `${enrichment.id}.png`;

    // Existing main image on this product (if any) — used to decide whether
    // to auto-promote a failed candidate.
    const existingRegen = ((enrichment as { regenerated_main_image?: string | null }).regenerated_main_image) ?? null;
    const existingPinned = ((enrichment as { pinned_main_url?: string | null }).pinned_main_url) ?? null;
    const hasExistingMain = !!(existingRegen || existingPinned);

    let mainPublic: string | null = null;
    let candidateUrlToStore: string | null = null;
    if (passed || !hasExistingMain) {
      // Promote candidate → final path. Removes legacy extensions first.
      await supabaseAdmin.storage
        .from("regenerated-images")
        .remove([`${enrichment.id}.webp`, `${enrichment.id}.jpg`])
        .catch(() => undefined);
      const { error: upErr } = await supabaseAdmin.storage
        .from("regenerated-images")
        .upload(mainPath, best.bytes, { contentType: "image/png", upsert: true });
      if (upErr) throw new Error(`Upload main: ${upErr.message}`);
      const { data: pub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(mainPath);
      mainPublic = `${pub.publicUrl}?v=${Date.now()}`;
      // Candidate no longer needed once promoted.
      await supabaseAdmin.storage.from("regenerated-images").remove([candidatePath]).catch(() => undefined);
    } else {
      // QC failed AND user already has a main image — keep it, expose the
      // candidate URL so the editor can offer accept / reject.
      candidateUrlToStore = best.publicUrl;
      await emit(ctx, {
        level: "warn",
        message: `⚠️ Miniatura ${productId.slice(0, 8)} nie przeszła QC — zachowuję dotychczasową; kandydat czeka na decyzję.`,
      });
    }

    const qcPersisted: ThumbnailQcPersisted = {
      ...best.qc,
      attempts,
      at: new Date().toISOString(),
      candidate_url: candidateUrlToStore,
    };
    // Merge onto existing image_meta without disturbing per-URL {w,h} entries.
    const mergedImageMeta = {
      ...(((enrichment as unknown as { image_meta?: Record<string, unknown> }).image_meta) ?? {}),
      thumbnail_qc: qcPersisted,
    } as Record<string, unknown>;

    await emit(ctx, {
      level: passed ? "success" : "warn",
      message: `🖼  Miniatura ${productId.slice(0, 8)} — QC: bg_white=${best.qc.bg_white ? "✓" : "✗"}, produkt=${best.qc.product_intact ? "✓" : "✗"}, kadr=${best.qc.framing_ok ? "✓" : "✗"} (${attempts} prób${attempts === 1 ? "a" : "y"}${qcSkipped ? ", QC pominięte" : ""})`,
    });

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
        // Only update image URLs when we actually promoted a new candidate.
        ...(mainPublic ? { regenerated_main_image: mainPublic } : {}),
        // Never overwrite a manually-pinned main image on a locked product.
        ...(mainPublic && !productLocked ? { pinned_main_url: mainPublic } : {}),
        ai_gallery_urls: galleryUrls as never,
        image_meta: mergedImageMeta as never,
      } as never)
      .eq("id", enrichment.id);
    if (dbErr) throw new Error(dbErr.message);
    // Only advance the pipeline when we actually produced a usable thumbnail.
    if (mainPublic) {
      await advancePipelineStatus(supabaseAdmin as never, product.id, "VISUALS_READY");
      await logProductEvent(supabaseAdmin, {
        projectId: product.project_id,
        productId: product.id,
        kind: "media_generated",
        message: `Miniatura wygenerowana (galeria: ${galleryUrls.length})`,
        meta: { slot: 0, gallery_count: galleryUrls.length },
      });
    }
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
  "newest", "newest-products", "nowosci", "nowo-sci",
  "bestseller", "bestsellers", "bestsellery", "top-sellers",
  "promo", "promocja", "promocje", "promotions",
  "products-list", "product-list", "products-grid", "product-grid",
  "product-tiles", "products-carousel", "product-carousel",
  "sidebar", "side-bar", "widget", "breadcrumb",
  "category-list", "categories", "shop-menu", "menu-list",
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

// Strip whole chrome elements regardless of attrs: nav/header/footer/aside +
// noise wrappers script/style/noscript. Balanced tag matcher.
function stripChromeElements(html: string): string {
  let out = html;
  for (const tag of ["nav", "header", "footer", "aside", "script", "style", "noscript"]) {
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    let guard = 0;
    while (guard++ < 100) {
      openRe.lastIndex = 0;
      const m = openRe.exec(out);
      if (!m) break;
      const start = m.index;
      const openEnd = m.index + m[0].length;
      const scanRe = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
      scanRe.lastIndex = openEnd;
      let depth = 1;
      let endIdx = -1;
      let s: RegExpExecArray | null;
      while ((s = scanRe.exec(out))) {
        if (s[0][1] === "/") {
          depth--;
          if (depth === 0) { endIdx = s.index + s[0].length; break; }
        } else {
          depth++;
        }
        if (scanRe.lastIndex - start > 400_000) break;
      }
      if (endIdx < 0) { out = out.slice(0, start); break; }
      out = out.slice(0, start) + out.slice(endIdx);
    }
  }
  return out;
}

function sliceBalancedElement(html: string, startIdx: number, tag: string): string | null {
  const openRe = new RegExp(`^<${tag}\\b[^>]*>`, "i");
  const head = html.slice(startIdx);
  const m = openRe.exec(head);
  if (!m) return null;
  const openEnd = startIdx + m[0].length;
  const scanRe = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  scanRe.lastIndex = openEnd;
  let depth = 1;
  let s: RegExpExecArray | null;
  while ((s = scanRe.exec(html))) {
    if (s[0][1] === "/") {
      depth--;
      if (depth === 0) return html.slice(startIdx, s.index + s[0].length);
    } else {
      depth++;
    }
    if (scanRe.lastIndex - startIdx > 800_000) break;
  }
  return null;
}

// Isolate a HTML region that is guaranteed to describe THE product:
// 1) schema.org/Product itemtype, 2) <main>, 3) <article>. Fall back to input.
function extractProductRegionHtml(html: string): string {
  const prodM = /<([a-z]+)\b[^>]*itemtype\s*=\s*["'][^"']*schema\.org\/Product[^"']*["'][^>]*>/i.exec(html);
  if (prodM) {
    const r = sliceBalancedElement(html, prodM.index, prodM[1]);
    if (r && r.length > 500) return r;
  }
  const mainM = /<main\b[^>]*>/i.exec(html);
  if (mainM) {
    const r = sliceBalancedElement(html, mainM.index, "main");
    if (r && r.length > 500) return r;
  }
  const artM = /<article\b[^>]*>/i.exec(html);
  if (artM) {
    const r = sliceBalancedElement(html, artM.index, "article");
    if (r && r.length > 500) return r;
  }
  return html;
}

/**
 * Wyciąga URL-e zdjęć produktu z galerii/lightboxa i metadanych produktu,
 * następnie normalizuje miniatury do największych znanych wariantów.
 */
export type ImageTier = 1 | 2 | 3;
export type PickedImages = {
  urls: string[];
  tiers: Record<string, ImageTier>;
};

export function pickImagesFromScrape(res: unknown): PickedImages {
  const out: string[] = [];
  const seen = new Set<string>();
  const tiers: Record<string, ImageTier> = {};
  // Highest tier wins if the same URL is discovered by multiple extractors.
  const push = (raw: unknown, tier: ImageTier) => {
    if (typeof raw !== "string") return;
    // Dwukrotny upgrade — czasem pierwsze przejście odsłania kolejny wzorzec.
    let t = upgradeToLargeImageUrl(raw.trim());
    t = upgradeToLargeImageUrl(t);
    if (!t || !/^https?:\/\//i.test(t)) return;
    const minDim = inferMinDimensionFromUrl(t);
    if (minDim !== null && minDim < 400) return;
    if (seen.has(t)) {
      // Promote to a stronger tier if we now see it in a more trusted zone.
      const prev = tiers[t] ?? 3;
      if (tier < prev) tiers[t] = tier;
      return;
    }
    seen.add(t);
    tiers[t] = tier;
    out.push(t);
  };

  const r = res as Record<string, unknown> | null;
  if (!r) return { urls: out, tiers };

  const rawHtml = typeof r.rawHtml === "string" ? r.rawHtml : (typeof r.html === "string" ? r.html : "");
  // 1) usuń całe chrome sklepu (nav/header/footer/aside/script/style)
  // 2) usuń bloki "polecane / bestsellery / newest"
  // 3) zawęź do regionu produktu (Product itemtype / main / article)
  const chromeless = rawHtml ? stripChromeElements(rawHtml) : "";
  const noRelated = chromeless ? stripRelatedProductBlocks(chromeless) : "";
  const html = noRelated ? extractProductRegionHtml(noRelated) : "";
  // Fallback pool for Tier 3: strip related/recommended before we ever look
  // outside the product region, so cross-sell carousels never bleed in.
  const outerHtml = noRelated || "";

  // JSON-LD Product images (product-scoped) — priorytetowe źródło zdjęć.
  const jsonLdProductImages: string[] = [];
  if (rawHtml) {
    const jsonLdRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (let m: RegExpExecArray | null; (m = jsonLdRe.exec(rawHtml)); ) {
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
          const t = obj["@type"];
          const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
          if (isProduct) {
            const img = obj.image ?? obj.contentUrl;
            const collect = (v: unknown) => {
              if (typeof v === "string") jsonLdProductImages.push(v);
              else if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") {
                jsonLdProductImages.push((v as { url: string }).url);
              }
            };
            if (Array.isArray(img)) img.forEach(collect);
            else collect(img);
          }
          for (const v of Object.values(obj)) {
            if (v && (Array.isArray(v) || typeof v === "object")) stack.push(v);
          }
        }
      } catch { /* skip malformed JSON-LD */ }
    }
  }
  // Tier 1: JSON-LD Product.image — the shop's declared product photos.
  for (const u of jsonLdProductImages) push(u, 1);

  if (html) {
    // 1) Lightbox/zoom: <a href="...jpg|png|webp">...<img...></a>
    const anchorRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:jpe?g|png|webp|avif))(?:\?[^"']*)?["'][^>]*>[\s\S]{0,800}?<img\b/gi;
    for (let m: RegExpExecArray | null; (m = anchorRe.exec(html)); ) push(m[1], 2);

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
      for (let m: RegExpExecArray | null; (m = re.exec(html)); ) push(m[1], 2);
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
          push(path, 2);
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
      if (bestUrl && bestW >= 400) push(bestUrl, 2);
      else if (bestUrl && bestW < 0) push(bestUrl, 2); // brak deklaracji szer. — wpuść
    }

    // 4) <img src=...> tylko jeśli ścieżka wygląda na katalog produktów.
    const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    for (let m: RegExpExecArray | null; (m = imgRe.exec(html)); ) {
      const src = m[1];
      if (looksLikeProductPath(src)) push(src, 2);
    }

    // 5) <link rel="preload" as="image" href="...">
    const preloadRe = /<link\b[^>]*\brel\s*=\s*["']preload["'][^>]*\bas\s*=\s*["']image["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
    for (let m: RegExpExecArray | null; (m = preloadRe.exec(html)); ) push(m[1], 2);
    const preloadRe2 = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']preload["'][^>]*\bas\s*=\s*["']image["']/gi;
    for (let m: RegExpExecArray | null; (m = preloadRe2.exec(html)); ) push(m[1], 2);

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
          // Bierzemy image tylko z węzłów Product — inaczej łapiemy inne
          // produkty widoczne w ItemList tej samej strony.
          const t = obj["@type"];
          const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
          if (isProduct) {
            const img = obj.image ?? obj.contentUrl;
            if (typeof img === "string") push(img, 2);
            else if (Array.isArray(img)) {
              for (const it of img) {
                if (typeof it === "string") push(it, 2);
                else if (it && typeof it === "object" && typeof (it as { url?: unknown }).url === "string") push((it as { url: string }).url, 2);
              }
            } else if (img && typeof img === "object" && typeof (img as { url?: unknown }).url === "string") {
              push((img as { url: string }).url, 2);
            }
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
    const mdImgRe = /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>]*)?/gi;
    for (let m: RegExpExecArray | null; (m = mdImgRe.exec(markdown)); ) {
      const cand = m[0].trim();
      if (looksLikeProductPath(cand)) push(cand, 3);
    }
  }

  // 7) metadata.ogImage / metadata["og:image"] — pełny obraz udostępniania.
  const meta = r.metadata as Record<string, unknown> | undefined;
  if (meta) {
    const cand = [meta.ogImage, meta["og:image"], meta.twitterImage, meta["twitter:image"]];
    for (const c of cand) if (typeof c === "string") push(c, 1);
  }
  // Outer HTML fallback (Tier 3) — only picks images that survived
  // stripRelatedProductBlocks so cross-sell carousels are already excluded.
  if (outerHtml && outerHtml !== html) {
    const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    for (let m: RegExpExecArray | null; (m = imgRe.exec(outerHtml)); ) {
      const src = m[1];
      if (looksLikeProductPath(src)) push(src, 3);
    }
  }

  // Jeśli JSON-LD wystawił zdjęcia produktu — one są priorytetowe. Do listy
  // dorzucamy tylko og:image (już w `out` przez §7) i odsiewamy resztę.
  if (jsonLdProductImages.length >= 2) {
    const primary: string[] = [];
    const seenP = new Set<string>();
    for (const raw of jsonLdProductImages) {
      let t = upgradeToLargeImageUrl(raw.trim());
      t = upgradeToLargeImageUrl(t);
      if (!/^https?:\/\//i.test(t) || seenP.has(t)) continue;
      seenP.add(t);
      primary.push(t);
      tiers[t] = 1;
    }
    // Dorzuć og:image jeżeli jest a nie ma go w Product.image.
    for (const u of out) if (!seenP.has(u) && /og[-_]?image|social|share/i.test(u)) primary.push(u);
    const filtered = filterImageUrls(primary).slice(0, 12);
    if (filtered.length) return { urls: filtered, tiers };
  }
  const filtered = filterImageUrls(out).slice(0, 12);
  return { urls: filtered, tiers };
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
  // Dodatkowo przepuszczamy przez sanitizer — wycina nav-walls, „Nowości",
  // „Zadzwoń", „Do koszyka" itp. zanim AI zobaczy syf.
  const focusedMarkdownRaw = extractDescriptionSection(pageMarkdown) ?? pageMarkdown;
  const focusedMarkdown = sanitizeProductDescription(focusedMarkdownRaw) || focusedMarkdownRaw;

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
    let dedup = filterImageUrls(imageUrls);
    // Vision AND-pass: Gemini ocenia miniaturki i wywala te, które nie są
    // fotografią tego konkretnego produktu (inne kafle z listingu).
    if (dedup.length) {
      try {
        const ordered = await visualFilterImages(apiKey, product.nazwa ?? "", dedup);
        // Canonical uncertainty policy: keep-images first, unsure appended
        // after, dropped (confidently-different / banner / logo / icon)
        // excluded. Manual overrides (image_scores[url].manual_keep,
        // pinned_main_url) are enforced downstream and always win.
        if (ordered) dedup = ordered;
      } catch (e) {
        console.warn("visualFilterImages non-fatal:", e);
      }
    }
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

// Vision filter: pyta Gemini czy każde ze zdjęć przedstawia konkretnie ten
// produkt. Zwraca Set URL-i do zachowania. Przy błędzie/timeout zwraca null
// — wtedy nie wycinamy nic dodatkowo poza filtrem tekstowym.
async function visualFilterImages(
  apiKey: string,
  productName: string,
  imageUrls: string[],
): Promise<string[] | null> {
  if (!imageUrls.length || !productName) return null;
  const top = imageUrls.slice(0, 8);
  const content = [
    { type: "text", text: [
      `Produkt: „${productName}".`,
      "Otrzymujesz zdjęcia jako kandydatów do galerii tego produktu.",
      "Zwróć JSON {\"keep\":[indeksy 1-based], \"unsure\":[indeksy 1-based]}.",
      "keep = zdjęcia na pewno tego produktu (ten sam wariant/rozmiar/kolor).",
      "unsure = nie można stwierdzić na pewno (niewyraźne, częściowo widoczne, słaby kadr).",
      "Pomiń indeks (nie dodawaj ani do keep, ani do unsure) TYLKO gdy na PEWNO to inny produkt, baner, logo lub ikona.",
    ].join("\n") },
    ...top.map((url) => ({ type: "image_url", image_url: { url } })),
  ] as unknown[];
  try {
    const call = callGatewayJson(apiKey, "google/gemini-2.5-flash", [
      { role: "user", content },
    ]);
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("vision timeout")), 15_000),
    );
    const parsed = (await Promise.race([call, timeout])) as { keep?: unknown; unsure?: unknown };
    const keepIdx = Array.isArray(parsed.keep)
      ? parsed.keep.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      : [];
    const unsureIdx = Array.isArray(parsed.unsure)
      ? parsed.unsure.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      : [];
    const keepUrls: string[] = [];
    const unsureUrls: string[] = [];
    const seen = new Set<string>();
    for (const i of keepIdx) {
      const u = top[i - 1];
      if (u && !seen.has(u)) { keepUrls.push(u); seen.add(u); }
    }
    for (const i of unsureIdx) {
      const u = top[i - 1];
      if (u && !seen.has(u)) { unsureUrls.push(u); seen.add(u); }
    }
    // Zdjęcia poza top-8 nie były oceniane — zachowujemy je na końcu.
    const tail: string[] = [];
    for (let i = 8; i < imageUrls.length; i++) {
      const u = imageUrls[i];
      if (!seen.has(u)) { tail.push(u); seen.add(u); }
    }
    // Ordering: confident-keep → unsure → untested. Ensures an unsure
    // image is never at index 0 unless there is no confident-keep at all,
    // so downstream main-image auto-selection prefers a confident image.
    return [...keepUrls, ...unsureUrls, ...tail];
  } catch (e) {
    console.warn("visualFilterImages failed:", e);
    return null;
  }
}

export async function runFirecrawlDiscovery(productId: string, ctx?: WorkerCtx): Promise<void> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
  const aiKey = process.env.LOVABLE_API_KEY;

  const { data: product, error: pErr } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, kod, ean, raw")
    .eq("id", productId)
    .single();
  if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

  const nazwa = (product.nazwa ?? "").trim();
  if (!nazwa) throw new Error("Produkt nie ma nazwy");

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("blacklist, strategy, settings")
    .eq("id", product.project_id)
    .single();
  const extraBlacklist = ((project?.blacklist as string[] | null) ?? []);
  const strategy = ((project?.strategy as QueryStrategy | null) ?? "NAZWA") as QueryStrategy;
  const projectSettings = (project?.settings as Record<string, unknown> | null) ?? {};
  const rawProvider = projectSettings.search_provider;
  const searchProvider: "firecrawl" | "apify" | "both" =
    rawProvider === "apify" ? "apify" : rawProvider === "firecrawl" ? "firecrawl" : "both";

  // Producent + MPN mogą być w raw.imported_extract (import z URL) lub — dla
  // CSV — częściowo w `source_products.kod` (kod producenta lub sklepu).
  const rawObj = (product.raw ?? {}) as {
    imported_extract?: {
      producent?: string | null;
      marka?: string | null;
      kod_producenta?: string | null;
    } | null;
  };
  const extracted = rawObj.imported_extract ?? null;
  const producent =
    (extracted?.producent ?? extracted?.marka ?? null)?.toString().trim() || null;
  const mpn =
    (extracted?.kod_producenta ?? product.kod ?? null)?.toString().trim() || null;

  const variants = buildQueryVariants(
    { nazwa, ean: product.ean ?? null, mpn, producent },
    strategy,
  );
  if (!variants.length) {
    await emit(ctx, { level: "warn", message: `⚠️ ${nazwa} — brak wariantów zapytań` });
    return;
  }

  await emit(ctx, {
    level: "info",
    message: `🔎 ${nazwa} — ${variants.length} wariant(ów): ${variants.map((v) => `[${v.kind}] "${v.query}"`).join(" | ")}`,
    details: { variants },
  });

  const firecrawl = new Firecrawl({ apiKey });

  // 1) Search per wariant. `providerRuns` is the canonical structure that
  //    later populates search_results.query_variants — one entry per query
  //    variant containing every discovered URL, its providers, AI pick
  //    marker and (after scraping) whether it was scraped.
  type VariantResult = {
    url: string;
    title?: string;
    snippet?: string;
    domain?: string;
    providers: Array<"firecrawl" | "apify">;
    ai_pick?: boolean;
    ai_reason?: string;
    filtered_out?: "marketplace" | "host_dup";
    scraped?: boolean;
  };
  type VariantBucket = {
    variant: string;
    kind: string;
    providers: { firecrawl?: number; apify?: number };
    results: VariantResult[];
  };
  const perVariant: VariantBucket[] = variants.map((v) => ({
    variant: v.query,
    kind: v.kind,
    providers: {},
    results: [],
  }));
  // key = variantIndex + "|" + normalizedUrl -> position in bucket.results
  const upsertResult = (vi: number, url: string, provider: "firecrawl" | "apify", meta: Partial<VariantResult>) => {
    const bucket = perVariant[vi];
    const key = normalizeUrlForDedup(url);
    let existing = bucket.results.find((r) => normalizeUrlForDedup(r.url) === key);
    if (!existing) {
      existing = { url, providers: [], ...meta };
      bucket.results.push(existing);
    } else {
      Object.assign(existing, meta);
    }
    if (!existing.providers.includes(provider)) existing.providers.push(provider);
  };

  const useApify = searchProvider === "apify" || searchProvider === "both";
  const useFirecrawl = searchProvider === "firecrawl" || searchProvider === "both";

  // ---- Firecrawl branch ----
  if (useFirecrawl) {
    for (let vi = 0; vi < variants.length; vi++) {
      const v = variants[vi];
      let hits: FirecrawlSearchHit[] = [];
      try {
        const sr = (await firecrawl.search(v.query, {
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
        await emit(ctx, { level: "warn", message: `⚠️ ${nazwa} — Firecrawl search [${v.kind}]: ${msg}` });
        continue;
      }
      let n = 0;
      for (const h of hits) {
        const url = (h.url ?? "").trim();
        if (!url) continue;
        upsertResult(vi, url, "firecrawl", {
          title: (h as { title?: string }).title,
          snippet: (h as { description?: string; snippet?: string }).description
            ?? (h as { snippet?: string }).snippet,
          domain: (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return undefined; } })(),
        });
        n++;
      }
      perVariant[vi].providers.firecrawl = n;
    }
  }

  // ---- Apify branch ----
  let aiPreselectMeta: { total: number; picked: number; error?: string } | null = null;
  if (useApify) {
    let buckets: Array<{ query: string; results: SerpResult[] }> = [];
    try {
      buckets = await runSerpSearch(variants.map((v) => v.query), {
        country: "PL",
        language: "pl",
        resultsPerQuery: 100,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await emit(ctx, {
        level: "warn",
        message: `⚠️ ${nazwa} — Apify SERP: ${msg}${useFirecrawl ? " (używam Firecrawl)" : ""}.`,
      });
      buckets = [];
    }

    // Flat pool across variants (used for AI preselect input).
    const flat: Array<{ i: number; title: string; snippet: string; url: string; domain: string; vi: number }> = [];
    let idx = 0;
    for (let vi = 0; vi < variants.length; vi++) {
      const v = variants[vi];
      const bucket = buckets.find((b) => b.query.trim().toLowerCase() === v.query.trim().toLowerCase())
        ?? buckets[vi];
      const results = bucket?.results ?? [];
      let n = 0;
      for (const r of results) {
        idx++;
        upsertResult(vi, r.url, "apify", {
          title: r.title,
          snippet: r.snippet,
          domain: r.domain,
        });
        flat.push({ i: idx, title: r.title, snippet: r.snippet, url: r.url, domain: r.domain, vi });
        n++;
      }
      perVariant[vi].providers.apify = n;
    }

    if (flat.length) {
      const capped = flat.slice(0, 40);
      const preselect = await preselectSerpResults({
        product: { nazwa, ean: product.ean ?? null, producent, kod_producenta: mpn },
        items: capped.map((f) => ({ i: f.i, title: f.title, snippet: f.snippet, domain: f.domain })),
      });
      const byI = new Map(flat.map((f) => [f.i, f]));
      type Pick = { url: string; why?: string; vi: number };
      let picks: Pick[] = [];
      if (preselect.ok && preselect.picks.length) {
        picks = preselect.picks
          .map((p): Pick | null => { const f = byI.get(p.i); return f ? { url: f.url, why: p.why, vi: f.vi } : null; })
          .filter((v): v is Pick => v !== null);
        aiPreselectMeta = { total: flat.length, picked: picks.length };
      } else {
        picks = flat.slice(0, 20).map((f) => ({ url: f.url, vi: f.vi }));
        aiPreselectMeta = { total: flat.length, picked: picks.length, error: preselect.error ?? "empty" };
      }
      for (const p of picks) {
        upsertResult(p.vi, p.url, "apify", { ai_pick: true, ai_reason: p.why });
      }
      await logProductEvent(supabaseAdmin, {
        projectId: product.project_id,
        productId: product.id,
        kind: "ai_preselect",
        message: `AI preselekcja: ${aiPreselectMeta.picked}/${aiPreselectMeta.total}${aiPreselectMeta.error ? ` (fallback: ${aiPreselectMeta.error})` : ""}`,
        meta: { model: "google/gemini-2.5-flash-lite", count: aiPreselectMeta.picked, provider_mode: searchProvider },
      });
      await emit(ctx, {
        level: "info",
        message: `🎯 ${nazwa} — Apify SERP: ${flat.length} wyników, AI wybrała ${picks.length}${aiPreselectMeta.error ? " (fallback)" : ""}`,
      });
    }
  }

  // Merged candidate pool: firecrawl results (always) + apify AI picks (only).
  // In pure "apify" mode there are no firecrawl results, so only picks survive.
  const mergedByNorm = new Map<string, string>();
  for (const b of perVariant) {
    for (const r of b.results) {
      const isFc = r.providers.includes("firecrawl");
      const isApifyPick = r.providers.includes("apify") && r.ai_pick === true;
      if (!isFc && !isApifyPick) continue;
      const key = normalizeUrlForDedup(r.url);
      if (!mergedByNorm.has(key)) mergedByNorm.set(key, r.url);
    }
  }
  const perVariantUrls = perVariant.map((b) => ({
    variant: b.variant,
    kind: b.kind,
    urls: b.results.map((r) => r.url),
  }));

  const allUrls = Array.from(mergedByNorm.values());
  if (!allUrls.length) {
    await emit(ctx, { level: "warn", message: `⚠️ ${nazwa} — brak wyników w żadnym wariancie` });
    await logProductEvent(supabaseAdmin, {
      projectId: product.project_id,
      productId: product.id,
      kind: "discovery_search",
      message: `Wyszukano źródła: ${variants.length} zapytań, 0 wyników`,
      meta: {
        variants: perVariantUrls.map((v) => ({ kind: v.kind, query: v.variant, results_count: v.urls.length })),
        provider_mode: searchProvider,
      },
    });
    return;
  }

  await logProductEvent(supabaseAdmin, {
    projectId: product.project_id,
    productId: product.id,
    kind: "discovery_search",
    message: `Wyszukano źródła: ${variants.length} zapytań, ${allUrls.length} unikalnych adresów`,
    meta: {
      variants: perVariantUrls.map((v) => ({ kind: v.kind, query: v.variant, results_count: v.urls.length })),
      provider_mode: searchProvider,
    },
  });

  // 2) Persist raw search result. Wstawiamy wiersz per term używany przez
  //    matching (nazwa / ean / "nazwa ean"), wszystkie z tym samym mergem —
  //    `query_variants` trzymamy tylko na wierszu głównym (nazwa) dla debug.
  const rowsToInsert: Array<Record<string, unknown>> = [];
  const seenTerms = new Set<string>();
  const pushTerm = (term: string, withVariants: boolean) => {
    const t = term.trim();
    if (!t || seenTerms.has(t.toLowerCase())) return;
    seenTerms.add(t.toLowerCase());
    rowsToInsert.push({
      project_id: product.project_id,
      term: t,
      organic_urls: allUrls,
      query_variants: withVariants ? (perVariant as unknown as Record<string, unknown>[]) : null,
    });
  };
  // Zawsze zapisz pod nazwą (matching NAZWA/HYBRID lookup).
  pushTerm(nazwa, true);
  if (product.ean) pushTerm((product.ean ?? "").trim(), false);
  if (strategy === "HYBRID" && product.ean) {
    pushTerm(`${nazwa} ${product.ean}`, false);
  }
  await supabaseAdmin.from("search_results").insert(rowsToInsert as never);

  // 3) Filter out marketplaces / blacklist, dedup po hoście (max 1 URL/host), top 5.
  const seenHosts = new Set<string>();
  const markFiltered = (url: string, reason: "marketplace" | "host_dup") => {
    const key = normalizeUrlForDedup(url);
    for (const b of perVariant) {
      const r = b.results.find((x) => normalizeUrlForDedup(x.url) === key);
      if (r && !r.filtered_out) r.filtered_out = reason;
    }
  };
  const filtered: string[] = [];
  for (const u of allUrls) {
    if (isMarketplaceUrl(u, extraBlacklist)) { markFiltered(u, "marketplace"); continue; }
    const h = (() => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } })();
    if (!h) { markFiltered(u, "marketplace"); continue; }
    if (seenHosts.has(h)) { markFiltered(u, "host_dup"); continue; }
    seenHosts.add(h);
    if (filtered.length < 5) filtered.push(u);
    else markFiltered(u, "host_dup");
  }
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
  const scrapedNorm = new Set<string>();
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
      scrapedNorm.add(normalizeUrlForDedup(url));
      const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      await emit(ctx, {
        level: "info",
        message: `   ♻️ ${host} — cache hit (<24h), pomijam scrape`,
        details: { url },
      });
      continue;
    }
    const res = await scrapeAndStoreSource(
      firecrawl,
      aiKey,
      { id: product.id, project_id: product.project_id, nazwa: product.nazwa ?? null, kod: product.kod ?? null, ean: product.ean ?? null },
      url,
      ctx,
    );
    if (res.ok) {
      scraped++;
      totalImages += res.imageCount;
      scrapedNorm.add(normalizeUrlForDedup(url));
      if (res.imageCount > 0) goodHits++;
    }
  }
  // Persist scraped flags back onto the query_variants JSON for UI transparency.
  if (scrapedNorm.size) {
    for (const b of perVariant) {
      for (const r of b.results) {
        if (scrapedNorm.has(normalizeUrlForDedup(r.url))) r.scraped = true;
      }
    }
    await supabaseAdmin
      .from("search_results")
      .update({ query_variants: perVariant as never } as never)
      .eq("project_id", product.project_id)
      .eq("term", nazwa);
  }
  await emit(ctx, {
    level: scraped ? "success" : "warn",
    message: `✅ ${nazwa} — zescrape'owano ${scraped}/${filtered.length} (${totalImages} zdjęć, ${cacheHits} z cache)`,
    details: { scraped, total: filtered.length, images: totalImages, cache_hits: cacheHits },
  });
  await logProductEvent(supabaseAdmin, {
    projectId: product.project_id,
    productId: product.id,
    kind: "discovery_scrape",
    message: `Zescrapowano ${scraped} stron (${filtered.length - scraped - cacheHits} pominiętych, ${cacheHits} z cache)`,
    meta: {
      scraped_urls: filtered.slice(0, scraped),
      total_candidates: filtered.length,
      cache_hits: cacheHits,
      images_found: totalImages,
    },
  });
  if (scraped > 0) {
    await advancePipelineStatus(supabaseAdmin as never, product.id, "SOURCES_FOUND");
  }
}

// ---------------------------------------------------------------------------
// Shared: scrape one URL with Firecrawl + AI filter, upsert into product_sources.
// Extracted so discovery + rescrape share identical logic (idempotent upsert).
// ---------------------------------------------------------------------------
export async function scrapeAndStoreSource(
  firecrawl: Firecrawl,
  aiKey: string | undefined,
  product: { id: string; project_id: string; nazwa: string | null; kod: string | null; ean: string | null },
  url: string,
  ctx: WorkerCtx | undefined,
): Promise<{ ok: boolean; imageCount: number }> {
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  try {
    const scrape = (await firecrawl.scrape(url, {
      formats: ["markdown", "rawHtml"],
      onlyMainContent: true,
    } as never)) as Record<string, unknown>;
    const meta = (scrape.metadata ?? {}) as Record<string, unknown>;
    const title = (meta.title as string | undefined) ?? (meta.ogTitle as string | undefined) ?? null;
    const rawMarkdown = typeof scrape.markdown === "string" ? scrape.markdown : "";
    const picked = pickImagesFromScrape(scrape);
    const candidateImages = picked.urls;
    const imageTiers = picked.tiers;

    await emit(ctx, {
      level: "info",
      message: `   🧠 ${host} — filtruję dane pod produkt (${candidateImages.length} kandydatów zdjęć)`,
      details: { url, candidates: candidateImages.length },
    });

    const filteredData = await filterScrapedForProduct(
      aiKey,
      { nazwa: product.nazwa, kod: product.kod, ean: product.ean },
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
      return { ok: false, imageCount: 0 };
    }

    const rejectedImages = candidateImages.filter((u) => !filteredData.imageUrls.includes(u));
    const imageMeta = filteredData.imageUrls.map((u) => ({ url: u, tier: (imageTiers[u] ?? 3) as 1 | 2 | 3 }));

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
          image_meta: imageMeta as never,
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
    return { ok: true, imageCount: filteredData.imageUrls.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("firecrawl scrape failed", url, e);
    await emit(ctx, { level: "warn", message: `   ⚠️ ${url} — ${msg}`, details: { url, error: msg } });
    return { ok: false, imageCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Run: PIM rescrape — top up weak-scored products by scraping the NEXT batch
// of unscraped search-result URLs, then re-run scoring for this product only.
// Hard cap of 2 rounds per product tracked on enrichments.rescrape_rounds.
// ---------------------------------------------------------------------------
export async function runPimRescrape(productId: string, ctx?: WorkerCtx): Promise<void> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
  const aiKey = process.env.LOVABLE_API_KEY;

  const { data: product, error: pErr } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, kod, ean, raw")
    .eq("id", productId)
    .single();
  if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

  const { data: enrichmentRow } = await supabaseAdmin
    .from("enrichments")
    .select("id, rescrape_rounds, picked_urls")
    .eq("source_product_id", productId)
    .maybeSingle();
  const enrichment = enrichmentRow as
    | { id: string; rescrape_rounds: number | null; picked_urls: string[] | null }
    | null;
  const rounds = enrichment?.rescrape_rounds ?? 0;
  if (rounds >= 2) {
    await emit(ctx, { level: "warn", message: `⏹ ${product.nazwa ?? productId} — osiągnięto limit rund doscrapowania (${rounds}/2)` });
    return;
  }

  const { data: projectRow } = await supabaseAdmin
    .from("projects")
    .select("blacklist")
    .eq("id", product.project_id)
    .single();
  const extraBlacklist = ((projectRow?.blacklist as string[] | null) ?? []);

  // Collect candidate URLs from search_results — union across all terms
  // (nazwa/ean/hybrid) previously stored for this product's project.
  const nazwa = (product.nazwa ?? "").trim();
  const terms: string[] = [];
  if (nazwa) terms.push(nazwa.toLowerCase());
  if (product.ean) terms.push((product.ean ?? "").trim().toLowerCase());
  if (nazwa && product.ean) terms.push(`${nazwa} ${product.ean}`.toLowerCase());
  const { data: searchRows } = await supabaseAdmin
    .from("search_results")
    .select("term, organic_urls, query_variants")
    .eq("project_id", product.project_id);
  const candidateSet = new Map<string, string>(); // norm -> original
  for (const r of searchRows ?? []) {
    const rr = r as { term: string; organic_urls: unknown; query_variants: unknown };
    if (!terms.includes(rr.term.trim().toLowerCase())) continue;
    const urls: string[] = [];
    if (Array.isArray(rr.organic_urls)) urls.push(...(rr.organic_urls as string[]));
    if (Array.isArray(rr.query_variants)) {
      for (const v of rr.query_variants as Array<{ urls?: string[] }>) {
        if (Array.isArray(v?.urls)) urls.push(...v.urls);
      }
    }
    for (const u of urls) {
      if (typeof u !== "string" || !u) continue;
      const key = normalizeUrlForDedup(u);
      if (!candidateSet.has(key)) candidateSet.set(key, u);
    }
  }
  const allCandidates = Array.from(candidateSet.values());
  if (!allCandidates.length) {
    await emit(ctx, { level: "warn", message: `⚠️ ${nazwa} — brak kandydatów do doscrapowania` });
    return;
  }

  // Exclude URLs already in product_sources for this project (idempotency).
  const { data: existing } = await supabaseAdmin
    .from("product_sources")
    .select("url")
    .eq("project_id", product.project_id)
    .in("url", allCandidates);
  const alreadyScraped = new Set((existing ?? []).map((r) => (r as { url: string }).url));

  const seenHosts = new Set<string>();
  const next3 = allCandidates
    .filter((u) => !alreadyScraped.has(u))
    .filter((u) => !isMarketplaceUrl(u, extraBlacklist))
    .filter((u) => {
      const h = (() => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } })();
      if (!h || seenHosts.has(h)) return false;
      seenHosts.add(h);
      return true;
    })
    .slice(0, 3);

  await emit(ctx, {
    level: next3.length ? "info" : "warn",
    message: `🔁 ${nazwa} — runda #${rounds + 1}/2 — ${next3.length} URL do doscrapowania (z ${allCandidates.length} znanych)`,
    details: { candidates: allCandidates.length, picked: next3 },
  });

  if (!next3.length) {
    // Still bump the counter so we do not loop forever.
    if (enrichment) {
      await supabaseAdmin
        .from("enrichments")
        .update({ rescrape_rounds: rounds + 1 } as never)
        .eq("id", enrichment.id);
    }
    return;
  }

  const firecrawl = new Firecrawl({ apiKey });
  const newlyScraped: string[] = [];
  for (const url of next3) {
    const res = await scrapeAndStoreSource(
      firecrawl,
      aiKey,
      { id: product.id, project_id: product.project_id, nazwa: product.nazwa ?? null, kod: product.kod ?? null, ean: product.ean ?? null },
      url,
      ctx,
    );
    if (res.ok) newlyScraped.push(url);
  }

  // Re-run scoring for this single product using existing picked_urls
  // union new URLs. We call the shared rescorer below.
  await rescoreSingleProduct(product.project_id, productId, aiKey, ctx);

  // Bump rounds counter.
  if (enrichment) {
    await supabaseAdmin
      .from("enrichments")
      .update({ rescrape_rounds: rounds + 1 } as never)
      .eq("id", enrichment.id);
  }
  await emit(ctx, {
    level: "success",
    message: `✅ ${nazwa} — doscrapowanie: +${newlyScraped.length} źródeł, przeliczono scoring (runda ${rounds + 1}/2)`,
  });
  await logProductEvent(supabaseAdmin, {
    projectId: product.project_id,
    productId: product.id,
    kind: "rescrape",
    message: `Doscrapowanie runda ${rounds + 1}/2: dodano ${newlyScraped.length} źródeł`,
    meta: { round: rounds + 1, added_urls: newlyScraped, count: newlyScraped.length },
  });
}

// Single-product rescorer. Mirrors the scoring block from runMatching but for
// one enrichment row. Uses supabaseAdmin because it is invoked from the worker.
async function rescoreSingleProduct(
  projectId: string,
  productId: string,
  aiKey: string | undefined,
  ctx: WorkerCtx | undefined,
): Promise<void> {
  const { scoreAndCapForProduct } = await import("./matching.functions");
  try {
    const res = await scoreAndCapForProduct(projectId, productId, aiKey);
    await emit(ctx, {
      level: res.count ? "info" : "warn",
      message: `   scoring: ${res.count} źródeł po capie TOP 5, ${res.strong} silnych (≥ próg)`,
      details: res,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit(ctx, { level: "warn", message: `   scoring nieudany: ${msg}` });
  }
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
    force_reanalyze?: boolean;
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
  const projectRequirementsPl = (payload?.requirementsPl ?? "").trim();
  const projectStylePl = (payload?.stylePrompt ?? "").trim();
  const forceReanalyze = !!payload?.force_reanalyze;
  // Combined PL block used as fallback when analysis fails AND as "OGRANICZENIA
  // PROJEKTU" appended to the vision prompt.
  const projectConstraintsPl = [
    projectStylePl ? `Styl / scena: ${projectStylePl}` : "",
    projectRequirementsPl ? `Wymagania: ${projectRequirementsPl}` : "",
  ].filter(Boolean).join("\n");

  const { data: product } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, raw, product_notes, manual_lock")
    .eq("id", productId)
    .single();
  if (!product) throw new Error("Product not found");
  const productName = ((product as { nazwa?: string | null }).nazwa ?? "").trim();
  const productDesc = (((product as { raw?: { opis?: string | null; description?: string | null } | null }).raw?.opis
    ?? (product as { raw?: { description?: string | null } | null }).raw?.description
    ?? "") as string).trim();
  const productNotes = ((product as { product_notes?: string | null }).product_notes ?? "").trim();

  const { data: projRow } = await supabaseAdmin
    .from("projects")
    .select("settings")
    .eq("id", (product as { project_id: string }).project_id)
    .single();
  const clientGuidelines =
    ((projRow?.settings as { client_guidelines?: string } | null)?.client_guidelines ?? "").trim();
  const constraintsHash = await sha256Hex(JSON.stringify({
    style: projectStylePl,
    requirements: projectRequirementsPl,
    client_guidelines: clientGuidelines,
  }));

  const { data: enrichment } = await supabaseAdmin
    .from("enrichments")
    .select("id, picked_urls, regenerated_main_image, pinned_main_url, ai_gallery_urls, golden_name, golden_description, golden_features, image_meta")
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
    golden_features: unknown;
    image_meta: Record<string, unknown> | null;
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

  // ---------- Per-product AI scene analysis (with cache & fallback) ----------
  const nameForPrompt = e.golden_name?.trim() || productName || "product";
  const descForPrompt = e.golden_description?.trim() || productDesc;
  const featuresText = Array.isArray(e.golden_features)
    ? (e.golden_features as unknown[])
        .map((f) => {
          if (typeof f === "string") return f;
          if (f && typeof f === "object") {
            const obj = f as { key?: string; name?: string; value?: string };
            const k = obj.key ?? obj.name ?? "";
            const v = obj.value ?? "";
            return `${k}: ${v}`.trim().replace(/^:\s*/, "");
          }
          return "";
        })
        .filter(Boolean)
        .slice(0, 8)
        .join("; ")
    : "";

  // Candidate source images for vision (main first, then rest of picked_urls).
  const analysisCandidates: string[] = [];
  if (e.pinned_main_url) analysisCandidates.push(e.pinned_main_url);
  if (e.regenerated_main_image && e.regenerated_main_image !== "__imported__") {
    analysisCandidates.push(e.regenerated_main_image);
  }
  for (const u of e.picked_urls ?? []) {
    if (u && u !== "__imported__") analysisCandidates.push(u);
  }
  const analysisUrls = Array.from(new Set(analysisCandidates)).slice(0, 4);
  const sourceUrlsHash = analysisUrls.length ? await sha256Hex(analysisUrls.join("|")) : "";

  type VizAnalysisRec = {
    style: string;
    requirements: string;
    at: string;
    source_urls_hash: string;
    constraints_hash?: string;
    manual?: boolean;
    source?: "vision" | "fallback_project" | "fallback_generic";
    has_text?: boolean;
    color_anchor_en?: string;
    reference_urls?: string[];
    consistency_at?: string;
  };
  const existingMeta = (e.image_meta ?? {}) as Record<string, unknown>;
  const cached = existingMeta.viz_analysis as VizAnalysisRec | undefined;

  let analysisPl: { style: string; requirements: string } | null = null;
  let analysisSource: VizAnalysisRec["source"] = "vision";
  let hasText = true;
  let colorAnchorEn = "";
  let cachedReferenceUrls: string[] | null = null;

  // 1) Manual overrides are never touched.
  if (cached?.manual && cached.style && cached.requirements) {
    analysisPl = { style: cached.style, requirements: cached.requirements };
    hasText = cached.has_text ?? true;
    colorAnchorEn = cached.color_anchor_en ?? "";
    cachedReferenceUrls = cached.reference_urls && cached.reference_urls.length ? cached.reference_urls : null;
    await emit(ctx, { level: "info", message: `   • używam ręcznej analizy sceny (manual override)` });
  } else if (
    !forceReanalyze &&
    cached?.style &&
    cached?.requirements &&
    cached.source_urls_hash === sourceUrlsHash &&
    cached.constraints_hash === constraintsHash &&
    sourceUrlsHash
  ) {
    // 2) Cached analysis for the same source set.
    analysisPl = { style: cached.style, requirements: cached.requirements };
    analysisSource = cached.source ?? "vision";
    hasText = cached.has_text ?? true;
    colorAnchorEn = cached.color_anchor_en ?? "";
    cachedReferenceUrls = cached.reference_urls && cached.reference_urls.length ? cached.reference_urls : null;
    await emit(ctx, { level: "info", message: `   • używam zapisanej analizy sceny (cache)` });
  } else if (analysisUrls.length) {
    // 3) Fresh vision analysis — up to 1 retry on API error.
    for (let attempt = 0; attempt < 2 && !analysisPl; attempt++) {
      try {
        await emit(ctx, {
          level: "info",
          message: `   • analizuję scenę per produkt (gemini-2.5-pro, ${analysisUrls.length} zdj)…`,
        });
        const out = await analyzeVisualizationSceneForProduct({
          productName: nameForPrompt,
          featuresText,
          imageUrls: analysisUrls,
          projectConstraintsPl,
        });
        analysisPl = { style: out.style, requirements: out.requirements };
        hasText = out.has_text;
        colorAnchorEn = out.color_anchor_en;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          await emit(ctx, { level: "warn", message: `   ⚠ analiza sceny błąd, ponawiam: ${msg}` });
        } else {
          await emit(ctx, { level: "warn", message: `   ⚠ analiza sceny nieudana: ${msg}` });
        }
      }
    }
  }

  // 4) Fallbacks when vision analysis failed or no images available.
  if (!analysisPl) {
    if (projectStylePl || projectRequirementsPl) {
      analysisPl = { style: projectStylePl, requirements: projectRequirementsPl };
      analysisSource = "fallback_project";
      await emit(ctx, { level: "info", message: `   • fallback: używam ustawień projektu` });
    } else {
      analysisPl = {
        style: "neutralna, jasna scena studyjno-lifestylowa; miękkie dzienne światło; naturalne rekwizyty pasujące do kategorii produktu",
        requirements:
          "kąt kamery lekki 3/4 z wysokości oczu; obiektyw 50mm; niewielka głębia ostrości; światło dzienne 5000K z lewej; zachowaj kolor, logo, etykiety i proporcje produktu dokładnie jak w źródle",
      };
      analysisSource = "fallback_generic";
      await emit(ctx, { level: "warn", message: `   ⚠ fallback: bezpieczna scena generyczna` });
    }
  }

  // Persist the analysis (unless it's a preserved manual override) so
  // re-runs skip the Gemini call while the source set is unchanged.
  //
  // Reference consistency: pick up to 3 refs from analysisUrls; if we have
  // 2+ candidates, ask Gemini once which are visually consistent with the
  // first (top-priority) reference. Cache the URL list on viz_analysis.
  let referenceUrlsForFal: string[] = [];
  if (cachedReferenceUrls && cachedReferenceUrls.length) {
    // Reuse only if every cached URL is still in analysisUrls (source set stable).
    const set = new Set(analysisUrls);
    if (cachedReferenceUrls.every((u) => set.has(u))) {
      referenceUrlsForFal = cachedReferenceUrls.slice(0, 3);
      await emit(ctx, { level: "info", message: `   • referencje: cache (${referenceUrlsForFal.length})` });
    }
  }
  if (!referenceUrlsForFal.length && analysisUrls.length) {
    const shortlist = analysisUrls.slice(0, 3);
    if (shortlist.length === 1) {
      referenceUrlsForFal = shortlist;
    } else {
      try {
        const apiKey2 = process.env.LOVABLE_API_KEY!;
        const consistent = await runReferenceConsistencyCheck(apiKey2, shortlist);
        referenceUrlsForFal = consistent.map((i) => shortlist[i]).filter(Boolean);
        if (referenceUrlsForFal.length < shortlist.length) {
          await emit(ctx, {
            level: "info",
            message: `   • spójność referencji: ${referenceUrlsForFal.length}/${shortlist.length} pasuje do referencji głównej`,
          });
        }
      } catch {
        // Fail-safe: use only the top reference so we never mix inconsistent images.
        referenceUrlsForFal = shortlist.slice(0, 1);
        await emit(ctx, { level: "warn", message: `   ⚠ nie udało się sprawdzić spójności referencji — używam tylko głównego zdjęcia` });
      }
    }
    if (!referenceUrlsForFal.length) referenceUrlsForFal = shortlist.slice(0, 1);
  }

  if (!cached?.manual && analysisSource !== "fallback_generic") {
    const nextMeta: Record<string, unknown> = {
      ...existingMeta,
      viz_analysis: {
        style: analysisPl.style,
        requirements: analysisPl.requirements,
        at: new Date().toISOString(),
        source_urls_hash: sourceUrlsHash,
        constraints_hash: constraintsHash,
        source: analysisSource,
        manual: false,
        has_text: hasText,
        color_anchor_en: colorAnchorEn,
        reference_urls: referenceUrlsForFal,
        consistency_at: new Date().toISOString(),
      } satisfies VizAnalysisRec,
    };
    await supabaseAdmin
      .from("enrichments")
      .update({ image_meta: nextMeta as never } as never)
      .eq("id", e.id)
      .then(() => undefined, () => undefined);
  }

  // Compose the Polish requirements block for buildFalPromptsFromPolish:
  // vision analysis first (style + requirements), then project constraints
  // as an authoritative override block (unless the analysis IS the project fallback).
  const perProductPl = [
    analysisPl.style ? `Scena: ${analysisPl.style}` : "",
    analysisPl.requirements,
  ].filter(Boolean).join("\n");
  const constraintsSuffix = analysisSource === "fallback_project" || !projectConstraintsPl
    ? ""
    : `\n\nOGRANICZENIA PROJEKTU (nadrzędne wobec sceny powyżej):\n${projectConstraintsPl}`;
  const combinedRequirementsPl = `${perProductPl}${constraintsSuffix}`.trim();

  if (!lifePrompt) {
    try {
      await emit(ctx, { level: "info", message: `   • buduję prompt EN (gemini-3.1-pro)…` });
      const built = await buildFalPromptsFromPolish({
        productName: nameForPrompt,
        productDesc: descForPrompt,
        requirementsPl: combinedRequirementsPl,
        projectStyle: "", // integrated into requirementsPl above
        clientGuidelines,
        productNotes,
      });
      lifePrompt = built.lifestyle_prompt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await emit(ctx, { level: "warn", message: `   ⚠ AI prompt fallback: ${msg}` });
      const fb = fallbackPrompts({
        productName: nameForPrompt,
        productDesc: descForPrompt,
        requirementsPl: combinedRequirementsPl,
        projectStyle: projectStylePl,
      });
      lifePrompt = fb.lifestyle_prompt;
    }
    await saveProgress(slotState);
    if (ctx?.deadline && Date.now() > ctx.deadline - 8_000) {
      await emit(ctx, { level: "info", message: `   • prompt gotowy — render wystartuje w następnym przebiegu` });
      return { complete: false };
    }
  }

  // Fallback single ref (used only if multi-ref list is empty for some reason,
  // e.g. no analysisUrls at all — keeps behaviour parity with the old code).
  const fallbackSingleRef = mainUrl;
  // Effective references for FAL image_urls (top reference first).
  const effectiveRefUrls: string[] =
    referenceUrlsForFal.length ? referenceUrlsForFal : [fallbackSingleRef];

  // Upload a FAL result to our bucket so we can persist it and run QC.
  const uploadGalleryCandidate = async (url: string, slot: number, attempt: number): Promise<string> => {
    const bytes = await fetchBytes(url);
    const stamp = Date.now();
    const path = `visualizations/${e.id}-${stamp}-${slot + 1}-a${attempt}.jpg`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("regenerated-images")
      .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: pub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(path);
    return `${pub.publicUrl}?v=${stamp}`;
  };

  // Commit a picked URL + its viz_qc metadata to the enrichment row.
  const commitVisualization = async (publicUrl: string, qc: VisualizationQcResult, attempts: number, slot: number) => {
    const { data: fresh, error: readErr } = await supabaseAdmin
      .from("enrichments")
      .select("ai_gallery_urls, image_meta")
      .eq("id", e.id)
      .single();
    if (readErr) throw new Error(readErr.message);
    const freshRow = fresh as {
      ai_gallery_urls?: string[] | null;
      image_meta?: Record<string, unknown> | null;
    };
    const existing = Array.isArray(freshRow.ai_gallery_urls)
      ? (freshRow.ai_gallery_urls ?? [])
      : [];
    const merged = existing.includes(publicUrl) ? existing : [...existing, publicUrl];
    const meta = (freshRow.image_meta ?? {}) as Record<string, unknown>;
    const vizQcMap = ((meta.viz_qc ?? {}) as Record<string, VisualizationQcPersisted>) || {};
    const passed = visualizationQcPassed(qc);
    vizQcMap[publicUrl] = {
      ...qc,
      passed,
      attempts,
      at: new Date().toISOString(),
      reference_url: effectiveRefUrls[0] ?? null,
    };
    const nextMeta: Record<string, unknown> = { ...meta, viz_qc: vizQcMap };
    const updatePayload: Record<string, unknown> = {
      ai_gallery_urls: merged,
      image_meta: nextMeta,
    };
    const { error: dbErr } = await supabaseAdmin
      .from("enrichments")
      .update(updatePayload as never)
      .eq("id", e.id);
    if (dbErr) throw new Error(dbErr.message);
    // If this viz failed product_intact, demote review_status on the
    // owning source_product — a broken visual on an approved product must
    // resurface. Never touch REJECTED. review_status lives on source_products.
    if (!passed) {
      const { data: prow } = await supabaseAdmin
        .from("source_products")
        .select("review_status")
        .eq("id", productId)
        .maybeSingle();
      const cur = (prow as { review_status?: string | null } | null)?.review_status ?? null;
      if (cur !== "REJECTED" && cur !== "NEEDS_REVIEW") {
        await supabaseAdmin
          .from("source_products")
          .update({ review_status: "NEEDS_REVIEW" } as never)
          .eq("id", productId);
      }
    }
    await emit(ctx, {
      level: passed ? "success" : "warn",
      message: passed
        ? `   ✔ wizualizacja ${slot + 1}/${count} zatwierdzona (viz QC pass, próby: ${attempts})`
        : `   ⚠ wizualizacja ${slot + 1}/${count} zapisana z ostrzeżeniem (viz QC fail po ${attempts} prób(ach)): ${(qc.issues[0] ?? "produkt niezgodny z referencją").slice(0, 140)}`,
    });
  };

  const isRefusal = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const status = errorStatus(err);
    return status === 422 || /\b422\b|could not generate|given prompts and images/i.test(msg);
  };

  // Colour-anchoring sentence for textless products. Adds concrete named
  // colours (from vision analysis) so the model doesn't invent a black core.
  const colourAnchorSentence = !hasText && colorAnchorEn
    ? ` COLOUR ANCHOR (authoritative): ${colorAnchorEn}. The product's surfaces MUST match these exact named colours in the output.`
    : "";

  const buildRequest = (mode: PimVisualizationSlot["mode"], extraSuffix?: string) => {
    const suffix = [colourAnchorSentence, extraSuffix ? ` RETRY CORRECTION: ${extraSuffix}` : ""]
      .filter(Boolean)
      .join("");
    if (mode === "safe-edit") {
      const safePrompt = [
        `Photorealistic square 1:1 product photo of "${nameForPrompt}".`,
        `Realistic in-use lifestyle scene, natural daylight, tasteful props, shallow depth of field.`,
        `Keep product, logo, printed text, colours, materials and proportions EXACTLY the same as the reference. Do not change the product's colours. Change only the background and scene.`,
        projectStylePl ? `Scene style: ${projectStylePl}.` : "",
        `Sharp, no motion blur, no text overlays, no watermarks.`,
      ].filter(Boolean).join(" ") + suffix;
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
        projectStylePl ? `Scene style: ${projectStylePl}.` : "",
        `Sharp focus, no motion blur, no text overlays, no watermarks, no logos.`,
      ].filter(Boolean).join(" ") + suffix;
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
        prompt: `${lifePrompt}${suffix}`,
        image_urls: [] as string[],
        aspect_ratio: "1:1",
        resolution: targetResolution,
        output_format: "jpeg",
        num_images: 1,
      },
    };
  };

  const cleanupSource = async (state: PimVisualizationSlot) => {
    const paths = [
      ...(state.sourcePaths ?? []),
      ...(state.sourcePath ? [state.sourcePath] : []),
    ];
    if (!paths.length) return;
    await supabaseAdmin.storage
      .from("regenerated-images")
      .remove(paths)
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
      const attempt = slotState.attempts ?? 0;
      await emit(ctx, {
        level: "info",
        message: `   • wizualizacja ${slot + 1}/${count} (próba ${attempt + 1}/3)…`,
      });
      if (!slotState.mode) slotState = { ...slotState, mode: "edit" };

      if (!slotState.request) {
        if (
          (slotState.mode === "edit" || slotState.mode === "safe-edit") &&
          (!slotState.sourceUrls || slotState.sourceUrls.length === 0)
        ) {
          const uploadedUrls: string[] = [];
          const uploadedPaths: string[] = [];
          for (const refUrl of effectiveRefUrls) {
            try {
              const source = await prepareFalSource(e.id, refUrl);
              uploadedUrls.push(source.url);
              uploadedPaths.push(source.path);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              await emit(ctx, { level: "warn", message: `   ⚠ nie udało się załadować referencji do FAL: ${msg.slice(0, 200)}` });
            }
          }
          if (!uploadedUrls.length) throw new Error("nie udało się przygotować żadnej referencji dla FAL");
          slotState = {
            ...slotState,
            sourceUrls: uploadedUrls,
            sourcePaths: uploadedPaths,
            sourceUrl: uploadedUrls[0],
            sourcePath: uploadedPaths[0],
          };
        }
        const req = buildRequest(slotState.mode, slotState.extraPromptSuffix);
        const body = req.body as { image_urls?: string[] };
        if (body.image_urls) {
          body.image_urls = slotState.sourceUrls && slotState.sourceUrls.length
            ? [...slotState.sourceUrls]
            : slotState.sourceUrl
              ? [slotState.sourceUrl]
              : [];
        }
        try {
          const queued = await submitFalQueue(req.path, req.body, FAL_KEY);
          slotState = { ...slotState, request: queued };
          await saveProgress(slotState);
          await emit(ctx, {
            level: "info",
            message: `   • FAL przyjął zadanie ${slot + 1}/${count} (${slotState.mode}, refs: ${body.image_urls?.length ?? 0})`,
          });
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
        const attemptsSoFar = (slotState.attempts ?? 0) + 1;
        // Upload the FAL result to our bucket so we can QC & keep it.
        const publicUrl = await uploadGalleryCandidate(genUrl, slot, attemptsSoFar);
        // Run Vision QC against the top reference. Gateway errors fall back
        // to a "passed" verdict so we never block generation on QC infra.
        let qc: VisualizationQcResult;
        try {
          const apiKey2 = process.env.LOVABLE_API_KEY!;
          qc = await runVisualizationQc(apiKey2, effectiveRefUrls[0], publicUrl);
        } catch (qcErr) {
          const msg = qcErr instanceof Error ? qcErr.message : String(qcErr);
          await emit(ctx, { level: "warn", message: `   ⚠ viz QC skipped (${msg.slice(0, 160)})` });
          qc = { product_intact: true, product_visible: true, issues: [] };
        }
        const score = visualizationQcScore(qc);
        const passed = visualizationQcPassed(qc);
        // Keep best across attempts.
        const prevBestScore = slotState.bestScore ?? -1;
        const isBetter = !slotState.bestUrl || score > prevBestScore;
        const bestUrl = isBetter ? publicUrl : slotState.bestUrl!;
        const bestQc = isBetter ? qc : slotState.bestQc!;
        const bestScore = isBetter ? score : prevBestScore;
        const enoughDeadlineForRetry = !ctx?.deadline || ctx.deadline - Date.now() > 60_000;
        if (!passed && attemptsSoFar < 3 && enoughDeadlineForRetry) {
          // Retry with a correction suffix derived from the QC issues.
          const correction = buildVisualizationCorrectionSentence(qc);
          await emit(ctx, {
            level: "warn",
            message: `   ⚠ viz QC fail (próba ${attemptsSoFar}/3): ${(qc.issues[0] ?? "produkt niezgodny").slice(0, 140)} — ponawiam z korektą`,
          });
          slotState = {
            ...slotState,
            request: undefined,
            attempts: attemptsSoFar,
            bestUrl,
            bestQc,
            bestScore,
            extraPromptSuffix: correction,
          };
          await saveProgress(slotState);
          continue;
        }
        // Commit the best candidate we have.
        await commitVisualization(bestUrl, bestQc, attemptsSoFar, slot);
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
  await advancePipelineStatus(supabaseAdmin as never, (product as { id: string }).id, "VISUALS_READY");
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
    .select("id, project_id, nazwa, kod, ean, product_notes, manual_lock, matching_mode")
    .eq("id", productId)
    .single();
  if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");
  if ((product as { manual_lock?: boolean }).manual_lock) {
    await emit(ctx, {
      level: "warn",
      message: `⏭ Pominięte (zablokowane): ${product.nazwa ?? productId} — opis Allegro`,
    });
    return;
  }

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

  const { data: projRow } = await supabaseAdmin
    .from("projects")
    .select("settings")
    .eq("id", product.project_id)
    .single();
  const clientGuidelines =
    ((projRow?.settings as { client_guidelines?: string } | null)?.client_guidelines ?? "") || "";
  const productNotes = (product as { product_notes?: string | null }).product_notes ?? "";
  const guidelinesBlock = buildClientGuidelinesBlock(clientGuidelines, productNotes);

  const isCompatibleMode =
    ((product as { matching_mode?: string | null }).matching_mode === "compatible");
  const compatibilityLine = isCompatibleMode
    ? "PRODUKT TYPU ZAMIENNIK/AKCESORIUM: opis może czerpać parametry techniczne i listy kompatybilności ze źródeł równoważnych, ale NIE przenoś nazw marek zamienników innych sklepów do nazwy i opisu; nazwą wiodącą jest nazwa z bazy klienta."
    : "";

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
    guidelinesBlock ? guidelinesBlock + "\n" : "",
    compatibilityLine,
    'Wygeneruj JSON {"html": string} — kompletny, sprzedażowy opis Allegro zgodny z system promptem. Bierz fakty wyłącznie z podanych danych.',
  ].filter(Boolean).join("\n");

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
  const shape = z
    .object({
      html: z.string().min(1).max(60000),
      data_sufficiency: z.enum(["full", "partial", "poor"]).optional(),
    })
    .parse(parsed);
  const html = sanitizeAllegroDescriptionHtml(shape.html);
  if (!html) throw new Error("Model zwrócił pusty opis");

  const { error: upErr } = await supabaseAdmin
    .from("enrichments")
    .update({
      allegro_description: html,
      allegro_generated_at: new Date().toISOString(),
      ...(shape.data_sufficiency ? { data_sufficiency: shape.data_sufficiency } : {}),
    } as never)
    .eq("id", enrichment.id);
  if (upErr) throw new Error(upErr.message);

  // Regeneration invalidates prior manual approval.
  try {
    const { data: prow } = await supabaseAdmin
      .from("source_products")
      .select("review_status")
      .eq("id", product.id)
      .maybeSingle();
    const cur = (prow as { review_status?: string | null } | null)?.review_status ?? null;
    if (cur === "APPROVED") {
      await supabaseAdmin
        .from("source_products")
        .update({
          review_status: "NEEDS_REVIEW",
          approved_at: null,
          approved_by: null,
        } as never)
        .eq("id", product.id);
      await emit(ctx, {
        level: "info",
        message: `[review-reset] ${product.nazwa ?? productId} — zatwierdzenie cofnięte po regeneracji opisu Allegro`,
      });
    }
  } catch { /* best-effort */ }

  await emit(ctx, { level: "success", message: `✅ Allegro: opis zapisany (${html.length} znaków)` });
  await logProductEvent(supabaseAdmin, {
    projectId: product.project_id,
    productId: product.id,
    kind: "allegro_generated",
    message: `Wygenerowano opis Allegro (${html.length} znaków)`,
    meta: { model: "openai/gpt-5.5", length: html.length },
  });
}

// ---------------------------------------------------------------------------
// runPimImageVerify — bulk AI image identity verification for a single product.
// Mirrors `analyzeProductImages` (ai.functions.ts) but runs under supabaseAdmin
// on the worker. Reuses the exact same scoring helper (`scoreOneImage`) and
// identity-version cache so results are indistinguishable from the per-product
// "Zweryfikuj zdjęcia ponownie" action. Respects manual_keep and hidden_images.
// Failures are logged and reported but do not stop the wider bulk job.
// ---------------------------------------------------------------------------
export async function runPimImageVerify(
  productId: string,
  ctx?: WorkerCtx,
  opts?: { force?: boolean },
): Promise<void> {
  const force = opts?.force === true;
  const { scoreOneImage, filterAliveImages, IDENTITY_VERSION, type: _t } = await import("./ai.functions").then(
    (m) => ({
      scoreOneImage: m.scoreOneImage,
      filterAliveImages: m.filterAliveImages,
      IDENTITY_VERSION: m.IDENTITY_VERSION,
      type: null as unknown,
    }),
  );

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  // Product info drives the identity prompt.
  const { data: product, error: pErr } = await supabaseAdmin
    .from("source_products")
    .select("id, nazwa, raw")
    .eq("id", productId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!product) throw new Error("Product not found");
  const rawObj = ((product as { raw?: Record<string, unknown> | null }).raw ?? {}) as Record<string, unknown>;
  const importedExtract = (rawObj as { imported_extract?: { marka?: string; producent?: string } })
    .imported_extract ?? {};
  const brand = String(importedExtract.marka ?? importedExtract.producent ?? "").trim();
  const productName = String((product as { nazwa?: string }).nazwa ?? "").trim();

  const { data: enrichment, error: eErr } = await supabaseAdmin
    .from("enrichments")
    .select("id, picked_urls, image_scores, pinned_main_url, regenerated_main_image, hidden_images")
    .eq("source_product_id", productId)
    .maybeSingle();
  if (eErr) throw new Error(eErr.message);
  if (!enrichment) {
    await emit(ctx, { level: "warn", message: "Pominięto: brak rekordu enrichment (uruchom Dopasowanie)" });
    return;
  }
  const enRow = enrichment as unknown as {
    id: string;
    picked_urls?: string[] | null;
    image_scores?: Record<string, { manual_keep?: boolean; identity_v?: number; dead?: boolean }> | null;
    pinned_main_url?: string | null;
    regenerated_main_image?: string | null;
    hidden_images?: string[] | null;
  };

  // Gather all image URLs (main + extras) from the product's source rows.
  const pickedUrls = (enRow.picked_urls ?? []) as string[];
  if (!pickedUrls.length) {
    await emit(ctx, { level: "info", message: "Brak źródeł do weryfikacji" });
    return;
  }
  const { data: sources } = await supabaseAdmin
    .from("product_sources")
    .select("url, images, extra_images")
    .in("url", pickedUrls);
  const allUrls: string[] = [];
  for (const s of (sources ?? []) as Array<{ images: string[] | null; extra_images: string[] | null }>) {
    for (const u of s.images ?? []) allUrls.push(u);
    for (const u of s.extra_images ?? []) allUrls.push(u);
  }
  const hidden = new Set((enRow.hidden_images ?? []) as string[]);
  const existing = (enRow.image_scores ?? {}) as Record<
    string,
    { manual_keep?: boolean; identity_v?: number; dead?: boolean }
  >;
  const uniq = Array.from(new Set(allUrls.filter((u) => !hidden.has(u))));
  if (!uniq.length) {
    await emit(ctx, { level: "info", message: "Brak zdjęć do weryfikacji" });
    return;
  }

  const needsCheck = (u: string): boolean => {
    const prev = existing[u];
    if (!prev) return true;
    if (prev.manual_keep === true) return false;
    if (prev.dead === true && !force) return false;
    if (force) return true;
    return (prev.identity_v ?? 0) < IDENTITY_VERSION;
  };
  let toScore = uniq.filter(needsCheck);
  let currentScores = existing as Record<string, unknown> as Record<string, {
    manual_keep?: boolean;
    identity_v?: number;
    dead?: boolean;
  }>;

  if (!toScore.length) {
    await emit(ctx, {
      level: "info",
      message: 'Wszystkie zdjęcia mają już aktualną weryfikację (użyj „wymuś", aby powtórzyć)',
    });
    return;
  }

  // Anchor picking — mirror analyzeProductImages exactly.
  const pickBestSameAnchor = (): string | null => {
    let bestUrl: string | null = null;
    let bestScore = -Infinity;
    for (const [u, s] of Object.entries(existing) as Array<[
      string,
      { identity?: string; is_banner_or_trash?: boolean; is_central?: number; is_clean?: number } | undefined,
    ]>) {
      if (!s || s.identity !== "same" || s.is_banner_or_trash) continue;
      const score = (s.is_central ?? 0) + (s.is_clean ?? 0);
      if (score > bestScore) {
        bestScore = score;
        bestUrl = u;
      }
    }
    return bestUrl;
  };
  const regen = enRow.regenerated_main_image;
  const anchorUrl: string | null =
    (enRow.pinned_main_url && enRow.pinned_main_url !== "__imported__" ? enRow.pinned_main_url : null) ??
    (regen && regen !== "__imported__" ? regen : null) ??
    pickBestSameAnchor();

  // Pre-flight probe so 404s don't waste Vision calls.
  const { alive, dead } = await filterAliveImages(
    supabaseAdmin as never,
    enRow.id,
    toScore,
    existing as never,
  );
  toScore = alive;
  if (dead.length) {
    const { data: refreshed } = await supabaseAdmin
      .from("enrichments")
      .select("image_scores")
      .eq("id", enRow.id)
      .maybeSingle();
    currentScores =
      ((refreshed as { image_scores?: Record<string, { manual_keep?: boolean; identity_v?: number; dead?: boolean }> } | null)?.image_scores ??
        existing) as Record<string, { manual_keep?: boolean; identity_v?: number; dead?: boolean }>;
    await emit(ctx, {
      level: "warn",
      message: `Pominięto ${dead.length} martwych URL-i (404/timeout)`,
    });
  }

  if (!toScore.length) {
    await emit(ctx, { level: "info", message: "Brak żywych zdjęć do weryfikacji" });
    return;
  }

  await emit(ctx, {
    level: "info",
    message: `Analiza AI: ${toScore.length} zdjęć${anchorUrl ? " (z obrazem referencyjnym)" : ""}`,
  });

  const CONCURRENCY = 5;
  const merged: Record<string, unknown> = { ...currentScores };
  let failed = 0;
  let succeeded = 0;
  for (let i = 0; i < toScore.length; i += CONCURRENCY) {
    const batch = toScore.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((u) => scoreOneImage(apiKey, u, productName, brand, anchorUrl && anchorUrl !== u ? anchorUrl : null)),
    );
    settled.forEach((r, idx) => {
      const url = batch[idx];
      if (r.status === "fulfilled") {
        const prevManual = (currentScores[url] as { manual_keep?: boolean } | undefined)?.manual_keep;
        merged[url] = prevManual ? { ...r.value, manual_keep: true } : r.value;
        succeeded += 1;
      } else {
        failed += 1;
      }
    });
  }

  // Size probing: for every accepted URL, capture dimensions and try the
  // upgraded (source-size) variant so downstream regen / list ranking can
  // prefer the largest available copy without re-probing next run.
  try {
    const { probeImageSize } = await import("./image-size.server");
    const targets = Array.from(new Set(toScore.filter((u) => {
      const cur = merged[u] as { w?: number; h?: number } | undefined;
      return !(cur?.w && cur?.h);
    })));
    const capped = targets.slice(0, 24);
    await Promise.all(capped.map(async (u) => {
      const origDim = await probeImageSize(u, 5000).catch(() => null);
      const upgraded = upgradeToLargeImageUrl(u);
      let bigDim: { w: number; h: number } | null = null;
      let bigUrl: string | null = null;
      if (upgraded !== u) {
        bigDim = await probeImageSize(upgraded, 5000).catch(() => null);
        if (bigDim && origDim && (bigDim.w * bigDim.h) > (origDim.w * origDim.h)) {
          bigUrl = upgraded;
        } else if (bigDim && !origDim) {
          bigUrl = upgraded;
        }
      }
      const cur = (merged[u] as Record<string, unknown> | undefined) ?? {};
      const patch: Record<string, unknown> = { ...cur };
      if (origDim) { patch.w = origDim.w; patch.h = origDim.h; }
      if (bigUrl && bigDim) {
        patch.large_url = bigUrl;
        // If we didn't get orig dims, at least record the upgraded size as authoritative.
        if (!origDim) { patch.w = bigDim.w; patch.h = bigDim.h; }
      }
      merged[u] = patch;
    }));
  } catch (e) {
    await emit(ctx, { level: "warn", message: `Probe rozmiaru pominięte: ${e instanceof Error ? e.message : "błąd"}` });
  }

  if (succeeded > 0) {
    const { error: upErr } = await supabaseAdmin
      .from("enrichments")
      .update({ image_scores: merged as never } as never)
      .eq("id", enRow.id);
    if (upErr) throw new Error(upErr.message);
  }

  await emit(ctx, {
    level: failed > 0 && succeeded === 0 ? "error" : "success",
    message: `✅ Weryfikacja: OK ${succeeded}, błędy ${failed}`,
  });
  try {
    const { data: p } = await supabaseAdmin
      .from("source_products")
      .select("project_id")
      .eq("id", productId)
      .maybeSingle();
    const projectId = (p as { project_id?: string } | null)?.project_id;
    if (projectId) {
      await logProductEvent(supabaseAdmin, {
        projectId,
        productId,
        kind: "image_verify",
        message: `Weryfikacja zdjęć: ${succeeded} przeanalizowanych, ${failed} błędów`,
        meta: { accepted_count: succeeded, rejected_images_count: failed },
      });
    }
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// runPimAudit — deterministic checks + LLM cross-check for a single product.
// Eligible when pipeline_status is GOLDEN_READY or VISUALS_READY. Skips
// products still in earlier stages. Runs on manually locked products too —
// it never modifies golden data, only enrichments.audit and review_status.
// ---------------------------------------------------------------------------
export async function runPimAudit(productId: string, ctx?: WorkerCtx): Promise<void> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const { data: product, error: pErr } = await supabaseAdmin
    .from("source_products")
    .select("id, project_id, nazwa, ean, pipeline_status, review_status")
    .eq("id", productId)
    .single();
  if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");
  const ps = (product as { pipeline_status?: string | null }).pipeline_status ?? "IMPORTED";
  if (ps !== "GOLDEN_READY" && ps !== "VISUALS_READY") {
    await emit(ctx, {
      level: "warn",
      message: `⏭ Pominięte (etap ${ps}): ${product.nazwa ?? productId} — audyt wymaga złotego rekordu`,
    });
    return;
  }

  const { data: enrichment } = await supabaseAdmin
    .from("enrichments")
    .select(
      "id, golden_name, golden_slug, golden_meta_description, golden_description, golden_features, data_sufficiency, score_breakdown, picked_urls, pinned_main_url, regenerated_main_image, image_scores, quality, image_meta",
    )
    .eq("source_product_id", product.id)
    .maybeSingle();
  if (!enrichment) {
    await emit(ctx, {
      level: "warn",
      message: `⏭ Pominięte (brak enrichment): ${product.nazwa ?? productId}`,
    });
    return;
  }

  const en = enrichment as typeof enrichment & {
    id: string;
    golden_name?: string | null;
    golden_slug?: string | null;
    golden_meta_description?: string | null;
    golden_description?: string | null;
    golden_features?: Array<{ key: string; value: string }> | null;
    data_sufficiency?: "full" | "partial" | "poor" | null;
    score_breakdown?: Array<{ url: string; total: number; ean_confirmed?: boolean }> | null;
    picked_urls?: string[] | null;
    pinned_main_url?: string | null;
    regenerated_main_image?: string | null;
    image_scores?: Record<string, { is_banner_or_trash?: boolean; identity?: string | null }> | null;
    quality?: { watermark_urls?: string[]; name_mismatch?: boolean } | null;
    image_meta?: Record<string, unknown> | null;
  };

  await emit(ctx, {
    level: "info",
    message: `🔎 Audyt AI: „${en.golden_name ?? product.nazwa ?? productId}"…`,
  });

  // Phase 1 — deterministic checks.
  const checks = auditChecks({
    golden_name: en.golden_name,
    golden_slug: en.golden_slug,
    golden_meta_description: en.golden_meta_description,
    golden_description: en.golden_description,
    golden_features: en.golden_features,
    data_sufficiency: en.data_sufficiency,
    ean: (product as { ean?: string | null }).ean,
    score_breakdown: en.score_breakdown,
    pinned_main_url: en.pinned_main_url,
    regenerated_main_image: en.regenerated_main_image,
    image_scores: en.image_scores,
    quality: en.quality,
    thumbnail_qc: (en.image_meta as { thumbnail_qc?: {
      bg_white?: boolean;
      product_intact?: boolean;
      framing_ok?: boolean;
      issues?: string[];
      candidate_url?: string | null;
    } } | null | undefined)?.thumbnail_qc ?? null,
    viz_qc: (en.image_meta as {
      viz_qc?: Record<
        string,
        { passed?: boolean; product_intact?: boolean; product_visible?: boolean; issues?: string[] }
      >;
    } | null | undefined)?.viz_qc ?? null,
  });

  const goldenComplete = checks.find((c) => c.check === "golden_complete")?.ok === true;

  // Phase 2 — LLM cross-check, only when Phase 1 passed golden_complete.
  let llm: AuditLlmResult | null = null;
  if (goldenComplete) {
    const { data: projRow } = await supabaseAdmin
      .from("projects")
      .select("settings")
      .eq("id", product.project_id)
      .single();
    const clientGuidelines =
      ((projRow?.settings as { client_guidelines?: string } | null)?.client_guidelines ?? "") || "";

    // Top 2 picked sources by score (falls back to picked_urls order).
    const picked = (en.picked_urls ?? []) as string[];
    const scoreByUrl = new Map<string, number>();
    for (const b of en.score_breakdown ?? []) scoreByUrl.set(b.url, b.total ?? 0);
    const topUrls = [...picked]
      .sort((a, b) => (scoreByUrl.get(b) ?? 0) - (scoreByUrl.get(a) ?? 0))
      .slice(0, 2);

    const { data: srcRows } = topUrls.length
      ? await supabaseAdmin
          .from("product_sources")
          .select("url, title, description")
          .in("url", topUrls)
      : { data: [] as Array<{ url: string; title: string | null; description: string | null }> };

    const userPrompt = buildAuditUserPrompt({
      goldenName: (en.golden_name ?? "").trim(),
      goldenDescriptionVisible: visibleText(en.golden_description ?? ""),
      features: en.golden_features ?? [],
      topSources: (srcRows ?? []) as Array<{
        url: string;
        title: string | null;
        description: string | null;
      }>,
      clientGuidelines,
    });

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "raw",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: AUDIT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (res.status === 429) throw new Error("RATE_LIMIT");
      if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
      if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = json.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as Partial<AuditLlmResult>;
      llm = {
        factual_issues: Array.isArray(parsed.factual_issues)
          ? parsed.factual_issues.slice(0, 10).map(String)
          : [],
        guideline_violations: Array.isArray(parsed.guideline_violations)
          ? parsed.guideline_violations.slice(0, 10).map(String)
          : [],
        style_issues: Array.isArray(parsed.style_issues)
          ? parsed.style_issues.slice(0, 10).map(String)
          : [],
        verdict:
          parsed.verdict === "pass" || parsed.verdict === "warn" || parsed.verdict === "fail"
            ? parsed.verdict
            : "warn",
      };
    } catch (e) {
      await emit(ctx, {
        level: "warn",
        message: `Audyt LLM pominięty: ${e instanceof Error ? e.message : "błąd"}`,
      });
      llm = null;
    }
  } else {
    await emit(ctx, {
      level: "warn",
      message: "Pominięto weryfikację LLM — złoty rekord niekompletny",
    });
  }

  const verdict = combineAuditVerdict(checks, llm);
  const result: AuditResult = {
    at: new Date().toISOString(),
    checks,
    llm,
    verdict,
  };

  const { error: upErr } = await supabaseAdmin
    .from("enrichments")
    .update({ audit: result as never } as never)
    .eq("id", en.id);
  if (upErr) throw new Error(upErr.message);

  const nextReview = verdictToReviewStatus(
    (product as { review_status?: string | null }).review_status ?? null,
    verdict,
  );
  if (nextReview) {
    await supabaseAdmin
      .from("source_products")
      .update({ review_status: nextReview } as never)
      .eq("id", product.id);
  }

  const summary =
    verdict === "pass"
      ? "✅ Audyt: OK"
      : verdict === "warn"
        ? "⚠ Audyt: ostrzeżenia — do przeglądu"
        : "❌ Audyt: błędy — do przeglądu";
  const failedNames = checks
    .filter((c) => !c.ok)
    .map((c) => c.check)
    .join(", ");
  await emit(ctx, {
    level: verdict === "fail" ? "error" : verdict === "warn" ? "warn" : "success",
    message: `${summary}${failedNames ? ` · ${failedNames}` : ""}`,
  });
  await logProductEvent(supabaseAdmin, {
    projectId: product.project_id,
    productId: product.id,
    kind: "audit_done",
    message: `Audyt AI: ${verdict}${failedNames ? ` · ${failedNames}` : ""}`,
    meta: { verdict, issues: checks.filter((c) => !c.ok).map((c) => c.check) },
  });
}
