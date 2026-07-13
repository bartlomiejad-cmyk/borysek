import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FAL_BASE = "https://fal.run";

type FalImage = { url: string; content_type?: string };
type FalResp = { images?: FalImage[]; image?: FalImage };

type ImageExt = "webp" | "jpg" | "png";

function encodeImageUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.pathname = u.pathname
      .split("/")
      .map((seg) => {
        if (!seg) return seg;
        let decoded = seg;
        try {
          decoded = decodeURIComponent(seg);
        } catch {
          decoded = seg;
        }
        return encodeURIComponent(decoded);
      })
      .join("/");
    return u.toString();
  } catch {
    return raw;
  }
}

async function callFal(path: string, body: unknown, apiKey: string): Promise<FalResp> {
  const res = await fetch(`${FAL_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("FAL: nieprawidłowy klucz API (FAL_KEY)");
  if (res.status === 402) throw new Error("FAL: brak kredytów — doładuj konto na fal.ai");
  if (res.status === 429) throw new Error("FAL: limit zapytań — spróbuj za chwilę");
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 422 && txt.includes("file_download_error")) {
      throw new Error("FAL nie mógł pobrać źródłowego zdjęcia (zły lub niedostępny URL)");
    }
    throw new Error(`FAL ${path} ${res.status}: ${txt.slice(0, 400)}`);
  }
  return (await res.json()) as FalResp;
}

function isWebpBytes(bytes: Uint8Array): boolean {
  // RIFF....WEBP
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  );
}

function isPngBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  );
}

function detectImageFormat(bytes: Uint8Array, contentType: string): { ext: ImageExt; contentType: string } {
  const ct = contentType.toLowerCase();
  if (isWebpBytes(bytes) || ct.includes("webp")) return { ext: "webp", contentType: "image/webp" };
  if (isPngBytes(bytes) || ct.includes("png")) return { ext: "png", contentType: "image/png" };
  return { ext: "jpg", contentType: ct.includes("jpeg") || ct.includes("jpg") ? contentType : "image/jpeg" };
}

async function fetchImageBytes(srcUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const safeUrl = encodeImageUrl(srcUrl);
  const res = await fetch(safeUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; LovableProductImageBot/1.0)",
    },
  });
  if (!res.ok) throw new Error(`Nie udało się pobrać zdjęcia źródłowego (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new Error("Zdjęcie źródłowe jest puste");
  return { bytes, contentType: res.headers.get("content-type") ?? "image/jpeg" };
}

async function prepareFalSourceImage(enrichmentId: string, srcUrl: string): Promise<{ url: string; path: string }> {
  const source = await fetchImageBytes(srcUrl);
  const format = detectImageFormat(source.bytes, source.contentType);
  const path = `fal-sources/${enrichmentId}-${Date.now()}.${format.ext}`;
  const { error } = await supabaseAdmin.storage
    .from("regenerated-images")
    .upload(path, source.bytes, { contentType: format.contentType, upsert: true });
  if (error) throw new Error(`Przygotowanie zdjęcia dla FAL nieudane: ${error.message}`);

  const { data: pub } = supabaseAdmin.storage
    .from("regenerated-images")
    .getPublicUrl(path);
  return { url: pub.publicUrl, path };
}

export const regenerateMainImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        enrichmentId: z.string().uuid(),
        imageUrl: z.string().url(),
        customStyle: z.string().max(600).optional(),
        customRequirements: z.string().max(800).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) throw new Error("FAL_KEY nie jest skonfigurowany");

    // Step 1 — bytedance/seedream v4 edit: biały seamless background,
    // miękki cień, produkt ~70% kadru, kwadrat 2560x2560.
    const sourceForFal = await prepareFalSourceImage(data.enrichmentId, data.imageUrl);
    let shot: FalResp;
    const customBlock = (() => {
      const parts: string[] = [];
      const s = (data.customStyle ?? "").trim();
      const r = (data.customRequirements ?? "").trim();
      if (s) parts.push(`STYLE HINT (from vision analysis): ${s}`);
      if (r) parts.push(`REQUIREMENTS HINT (from vision analysis): ${r}`);
      if (!parts.length) return "";
      return (
        "\n\nADDITIONAL VISION-BASED HINTS (secondary to the hard rules above): " +
        parts.join(" | ") +
        " — but the WHITE #FFFFFF background, product colour fidelity, label/logo preservation and 70–75% framing rules ABOVE take absolute priority; if a hint conflicts with them, IGNORE the hint."
      );
    })();
    try {
      shot = await callFal(
        "fal-ai/bytedance/seedream/v4/edit",
        {
          image_urls: [sourceForFal.url],
          prompt:
            "BACKGROUND = flat solid #FFFFFF fill, RGB(255,255,255), luminance L=100, a mathematically flat white plane. NO lighting variation, NO falloff, NO vignette, NO gradient, NO ambient shadow bleeding into the background, NO soft-box reflection, NO seamless paper curve, NO paper texture, NO warm tint, NO cool tint, NO gray, NO off-white. Identical pixel value #FFFFFF in ALL FOUR CORNERS and along ALL FOUR EDGES of the canvas. If anything on the background is darker than #FAFAFA anywhere in the frame, the output is WRONG. If in doubt, make the background brighter and whiter, never warmer or grayer. CRITICAL COLOUR (product): Preserve the product's own colour(s) pixel-faithfully — hue, saturation and tone identical to the source reference. DO NOT desaturate, whiten, lighten, brighten, bleach or shift the hue of the product body, cover, packaging, printed graphics or labels. If the source product is green, the output stays that exact green; the same applies to every other colour. The product must not be tinted to match the white background. Move the exact same product onto this pure white #FFFFFF seamless studio background. Keep the product identical to the input image: preserve every printed label, logo, brand name, illustration, color, material and proportions exactly as in the source — do NOT redraw, restyle or remove any packaging text or graphics that are physically printed on the product. CRITICAL FRAMING: scale the product UP so it fills 70–75% of the frame in BOTH width and height — the longest edge of the product must span about 75% of the canvas. Center the product both horizontally and vertically with equal small margins on all four sides (~12–15% of canvas). Do NOT leave large empty white space around the product, do NOT push the product to the bottom or top, do NOT render it small in the middle of an empty canvas. Add a soft realistic contact shadow directly under the product (shadow only under the product, never tinting the background). WATERMARK REMOVAL: remove any watermarks, store logos, website URLs, photo credits, shop names and any semi-transparent overlay text that are NOT physically printed on the product packaging itself. Keep only graphics and text that physically exist on the product/packaging. Sharp focus, professional e-commerce product photography, accurate colors. AVOID: gray background, light gray, silver, off-white, warm white, cool white, cream/beige/ivory background, studio seamless curve, ambient shadow bleeding into background, gradient from light to slightly darker, any pixel below 250,250,250 on the background, tint, vignette, paper texture, missing labels, blurred text, regenerated artwork, tiny product, product smaller than 50% of frame, excessive whitespace, off-center composition, product pushed to bottom or top, visible watermarks, shop URLs, overlay text, photo credits, whitened/desaturated/bleached product body, colour drift, product tinted to match the background." + customBlock,
          image_size: { width: 2560, height: 2560 },
          num_images: 1,
          sync_mode: true,
          enable_safety_checker: true,
          output_format: "jpeg",
        },
        FAL_KEY,
      );
    } finally {
      await supabaseAdmin.storage
        .from("regenerated-images")
        .remove([sourceForFal.path])
        .catch(() => undefined);
    }
    const generatedUrl = shot.images?.[0]?.url;
    if (!generatedUrl) throw new Error("FAL nie zwróciło zdjęcia");

    // Step 2 — enforce a mathematically pure #FFFFFF background: strip whatever
    // tint the model left and composite the product over flat white. Deterministic,
    // no more beige/gray residue that pure-prompt engineering can't guarantee.
    const { flattenToWhiteBackground } = await import("./_workers.server");
    const bytes = await flattenToWhiteBackground(generatedUrl, FAL_KEY);
    const ext: ImageExt = "png";
    const contentType = "image/png";

    const path = `${data.enrichmentId}.${ext}`;

    // Wyczyść stare warianty (gdyby poprzednio był JPG, a teraz WebP itp.).
    await supabaseAdmin.storage
      .from("regenerated-images")
      .remove([`${data.enrichmentId}.webp`, `${data.enrichmentId}.jpg`, `${data.enrichmentId}.png`])
      .catch(() => undefined);

    const { error: upErr } = await supabaseAdmin.storage
      .from("regenerated-images")
      .upload(path, bytes, { contentType, upsert: true });
    if (upErr) throw new Error(`Upload nieudany: ${upErr.message}`);

    const { data: pub } = supabaseAdmin.storage
      .from("regenerated-images")
      .getPublicUrl(path);
    const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;

    const { error: dbErr } = await context.supabase
      .from("enrichments")
      .update({
        regenerated_main_image: publicUrl,
        pinned_main_url: publicUrl,
      } as never)
      .eq("id", data.enrichmentId);
    if (dbErr) throw new Error(dbErr.message);

    return { url: publicUrl };
  });

export const clearRegeneratedImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ enrichmentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await supabaseAdmin.storage
      .from("regenerated-images")
      .remove([`${data.enrichmentId}.webp`, `${data.enrichmentId}.jpg`])
      .catch(() => undefined);
    // Pobierz aktualny stan, żeby odpiąć pin tylko jeśli wskazywał na regen.
    const { data: cur } = await context.supabase
      .from("enrichments")
      .select("pinned_main_url, regenerated_main_image")
      .eq("id", data.enrichmentId)
      .maybeSingle();
    const pinned = (cur as { pinned_main_url?: string | null } | null)?.pinned_main_url ?? null;
    const regen = (cur as { regenerated_main_image?: string | null } | null)?.regenerated_main_image ?? null;
    const patch: Record<string, unknown> = { regenerated_main_image: null };
    if (pinned && regen && pinned === regen) patch.pinned_main_url = null;
    const { error } = await context.supabase
      .from("enrichments")
      .update(patch as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });