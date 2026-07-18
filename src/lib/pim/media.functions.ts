import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ----------------------------------------------------------------------------
// Types & constants
// ----------------------------------------------------------------------------

const FAL_BASE = "https://fal.run";
const CLASSIFY_MODEL = "google/gemini-2.5-flash";

export type MainImageRule = "ONLY_A" | "A_AND_B_EXISTING" | "COMPOSITE_A_AND_B";

export type MediaSettings = {
  component_a: string;
  component_b: string | null;
  main_image_rule: MainImageRule;
  target_resolution: number;
  padding_percent: number;
  max_gallery_images: number;
  apply_shadow: boolean;
  custom_style_prompt: string | null;
};

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  component_a: "",
  component_b: null,
  main_image_rule: "ONLY_A",
  target_resolution: 2560,
  padding_percent: 70,
  max_gallery_images: 5,
  apply_shadow: true,
  custom_style_prompt: null,
};

type Classification = {
  has_a: boolean;
  has_b: boolean;
  is_trash: boolean;
  scored_at: string;
};

type FalImage = { url: string };
type FalResp = { images?: FalImage[]; image?: FalImage };

// ----------------------------------------------------------------------------
// Settings CRUD
// ----------------------------------------------------------------------------

const SettingsSchema = z.object({
  projectId: z.string().uuid(),
  component_a: z.string().max(200).default(""),
  component_b: z.string().max(200).nullable().optional(),
  main_image_rule: z.enum(["ONLY_A", "A_AND_B_EXISTING", "COMPOSITE_A_AND_B"]).default("ONLY_A"),
  target_resolution: z.number().int().min(512).max(4096).default(2560),
  padding_percent: z.number().int().min(30).max(95).default(70),
  max_gallery_images: z.number().int().min(0).max(12).default(5),
  apply_shadow: z.boolean().default(true),
  custom_style_prompt: z.string().max(2000).nullable().optional(),
});

export const getMediaSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<MediaSettings> => {
    const { data: row } = await context.supabase
      .from("media_technical_settings" as never)
      .select("*")
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (!row) return { ...DEFAULT_MEDIA_SETTINGS };
    const r = row as unknown as MediaSettings & { project_id: string };
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
  });

export const saveMediaSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SettingsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      project_id: data.projectId,
      component_a: data.component_a,
      component_b: data.component_b ?? null,
      main_image_rule: data.main_image_rule,
      target_resolution: data.target_resolution,
      padding_percent: data.padding_percent,
      max_gallery_images: data.max_gallery_images,
      apply_shadow: data.apply_shadow,
      custom_style_prompt: data.custom_style_prompt ?? null,
    };
    const { error } = await context.supabase
      .from("media_technical_settings" as never)
      .upsert(payload as never, { onConflict: "project_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// Classification (Gemini)
// ----------------------------------------------------------------------------

async function classifyOneImage(
  apiKey: string,
  url: string,
  componentA: string,
  componentB: string | null,
  timeoutMs = 15000,
): Promise<Classification> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sys =
      "Jesteś ekspertem klasyfikacji zdjęć produktowych. Zwracasz wyłącznie surowy JSON.";
    const user = [
      `Komponent A = "${componentA}".`,
      `Komponent B = ${componentB ? `"${componentB}"` : "BRAK"}.`,
      "",
      'Zwróć JSON: {"has_a": bool, "has_b": bool, "is_trash": bool}.',
      "",
      "has_a: true jeśli zdjęcie wyraźnie pokazuje Komponent A (sam produkt lub jego opakowanie z grafiką).",
      "has_b: true jeśli zdjęcie wyraźnie pokazuje Komponent B w tym samym kadrze. Gdy B = BRAK, zawsze false.",
      "is_trash: true jeśli zdjęcie to baner reklamowy, infografika, tabela rozmiarów, ikona, sam tekst, logo sklepu, kolaż.",
      "Watermarki/loga sklepu na zdjęciu w wysokiej rozdzielczości → NIE oznaczaj jako trash (FAL je usunie).",
      "W razie wątpliwości: has_a=false, has_b=false, is_trash=false.",
    ].join("\n");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              { type: "text", text: user },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`classify ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { has_a?: boolean; has_b?: boolean; is_trash?: boolean };
    return {
      has_a: !!parsed.has_a,
      has_b: !!parsed.has_b && !!componentB,
      is_trash: !!parsed.is_trash,
      scored_at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(t);
  }
}

async function classifyBatch(
  apiKey: string,
  urls: string[],
  a: string,
  b: string | null,
  concurrency = 6,
): Promise<Record<string, Classification>> {
  const out: Record<string, Classification> = {};
  let idx = 0;
  const worker = async () => {
    while (idx < urls.length) {
      const myIdx = idx++;
      const u = urls[myIdx];
      try {
        out[u] = await classifyOneImage(apiKey, u, a, b);
      } catch (e) {
        // Soft fallback: treat as unknown, non-trash, so it can still be used.
        console.warn("classify failed", u, e);
        out[u] = { has_a: false, has_b: false, is_trash: false, scored_at: new Date().toISOString() };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, urls.length)) }, worker));
  return out;
}

export const classifyProductMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ productId: z.string().uuid(), force: z.boolean().default(false) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
    const { supabase } = context;

    const { data: product } = await supabase
      .from("source_products")
      .select("id, project_id")
      .eq("id", data.productId)
      .single();
    if (!product) throw new Error("Product not found");

    const settings = await loadSettings(product.project_id);
    if (!settings.component_a.trim()) throw new Error("Skonfiguruj Komponent A w ustawieniach AI");

    const { data: project } = await supabase
      .from("projects")
      .select("include_extra_images")
      .eq("id", product.project_id)
      .single();
    const includeExtra = (project as { include_extra_images?: boolean } | null)?.include_extra_images ?? false;

    const { data: enrichment } = await supabase
      .from("enrichments")
      .select("id, picked_urls, media_classification")
      .eq("source_product_id", product.id)
      .maybeSingle();
    if (!enrichment) throw new Error("Brak enrichment — uruchom najpierw dopasowanie");

    const urls = await collectScrapedUrls(product.project_id, (enrichment.picked_urls as string[] | null) ?? [], includeExtra);
    if (!urls.length) return { ok: true, classified: 0 };

    const cached = data.force
      ? {}
      : (((enrichment as unknown as { media_classification?: Record<string, Classification> }).media_classification) ?? {});
    const toClassify = urls.filter((u) => !cached[u]);
    const fresh = toClassify.length
      ? await classifyBatch(apiKey, toClassify, settings.component_a, settings.component_b)
      : {};
    const merged = { ...cached, ...fresh };

    const { error } = await supabase
      .from("enrichments")
      .update({ media_classification: merged as never } as never)
      .eq("id", enrichment.id);
    if (error) throw new Error(error.message);
    return { ok: true, classified: Object.keys(fresh).length, total: urls.length };
  });

// ----------------------------------------------------------------------------
// Regeneracja (main + galeria)
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// Prompt builder
// ----------------------------------------------------------------------------

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
  lines.push(
    `CRITICAL BACKGROUND: The background MUST be PURE WHITE #FFFFFF (RGB 255,255,255) — absolutely no cream, no beige, no ivory, no off-white, no warm tint, no gray, no gradient, no vignette, no paper texture. All four corners of the canvas must be exactly #FFFFFF. If in doubt, make the background BRIGHTER and WHITER, not warmer.`,
  );
  if (opts.isComposite && opts.componentB) {
    lines.push(
      `COMPOSITION: Place "${opts.componentB}" naturally beside "${opts.componentA}" in one frame. Both elements in sharp focus, realistic relative scale, slight overlap allowed. Treat them as a single product set.`,
    );
  } else {
    lines.push(
      `SUBJECT: Move the exact same product ("${opts.componentA}") onto a clean pure white #FFFFFF seamless studio background.`,
    );
  }
  lines.push(
    `FRAMING: Scale the product UP so it fills ${fill}% of the frame in BOTH width and height. Center horizontally and vertically with equal small margins on all sides. Do NOT leave large empty white space, do NOT push the product to bottom/top.`,
  );
  if (opts.applyShadow) {
    lines.push(
      `SHADOW: Add a soft realistic contact shadow directly under the product only — never tint the background.`,
    );
  } else {
    lines.push(`SHADOW: No shadow. Product floats cleanly on pure white.`);
  }
  lines.push(
    `PRESERVE: Keep every printed label, logo, brand name, illustration, color, material and proportions exactly as in the source — do NOT redraw, restyle or remove any packaging text or graphics that are physically printed on the product.`,
  );
  lines.push(
    `WATERMARK REMOVAL: Remove any watermarks, store logos, website URLs, photo credits, shop names and semi-transparent overlay text that are NOT physically printed on the product packaging itself.`,
  );
  if (opts.customStyle && opts.customStyle.trim()) {
    lines.push(`STYLE: ${opts.customStyle.trim()}`);
  }
  lines.push(
    `AVOID: cream/beige/ivory/warm background, gray background, tint, vignette, paper texture, tiny product, product smaller than 50% of frame, excessive whitespace, off-center composition, blurred text, regenerated artwork, missing labels, visible watermarks, shop URLs, overlay text.`,
  );
  return lines.join(" ");
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function loadSettings(projectId: string): Promise<MediaSettings> {
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

async function collectScrapedUrls(
  projectId: string,
  pickedUrls: string[],
  includeExtra: boolean,
): Promise<string[]> {
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
    for (const u of [...main, ...extra]) {
      if (!seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    }
  }
  return out;
}

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
    headers: {
      Accept: "image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; LovableProductImageBot/1.0)",
    },
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function prepareFalSource(
  enrichmentId: string,
  srcUrl: string,
): Promise<{ url: string; path: string }> {
  const bytes = await fetchBytes(srcUrl);
  const path = `fal-sources/${enrichmentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from("regenerated-images")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Prepare FAL source: ${error.message}`);
  const { data: pub } = supabaseAdmin.storage.from("regenerated-images").getPublicUrl(path);
  return { url: pub.publicUrl, path };
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