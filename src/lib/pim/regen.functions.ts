import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FAL_BASE = "https://fal.run";

type FalImage = { url: string; content_type?: string };
type FalResp = { images?: FalImage[]; image?: FalImage };

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

async function tryConvertToWebpViaFal(
  srcUrl: string,
  apiKey: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const conv = await callFal(
      "fal-ai/imageutils/image-conversion",
      { image_url: encodeImageUrl(srcUrl), output_format: "webp" },
      apiKey,
    );
    const outUrl = conv.image?.url ?? conv.images?.[0]?.url;
    if (!outUrl) return null;
    const res = await fetch(outUrl);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!isWebpBytes(bytes)) {
      console.warn("[regen] image-conversion returned non-webp bytes, content-type:", ct);
      return null;
    }
    return { bytes, contentType: "image/webp" };
  } catch (e) {
    console.warn("[regen] fal image-conversion failed", e);
    return null;
  }
}

export const regenerateMainImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        enrichmentId: z.string().uuid(),
        imageUrl: z.string().url(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) throw new Error("FAL_KEY nie jest skonfigurowany");

    // Step 1 — bytedance/seedream v4 edit: biały seamless background,
    // miękki cień, produkt ~70% kadru, kwadrat 2560x2560.
    const shot = await callFal(
      "fal-ai/bytedance/seedream/v4/edit",
      {
        image_urls: [data.imageUrl],
        prompt:
          "Move the exact same product onto a pure white seamless studio background. The background color must be #FFFFFF, RGB 255,255,255 — no warm tint, no gradient, no paper texture. Keep the product identical to the input image: preserve every printed label, logo, brand name, illustration, color, material and proportions exactly as in the source — do NOT redraw, restyle or remove any packaging text or graphics. Add a soft realistic contact shadow directly under the product. Center the product, occupying about 70 percent of the frame with even margins. Sharp focus, professional e-commerce product photography, accurate colors. Avoid: cream background, beige, off-white, missing labels, blurred text, regenerated artwork.",
        image_size: { width: 2560, height: 2560 },
        num_images: 1,
        sync_mode: true,
        enable_safety_checker: true,
      },
      FAL_KEY,
    );
    const generatedUrl = shot.images?.[0]?.url;
    if (!generatedUrl) throw new Error("FAL nie zwróciło zdjęcia");

    // Step 2 — spróbuj konwersji do WebP po stronie FAL (image-conversion).
    // Jeśli się nie uda lub zwróci inny format, zapisujemy oryginał jako JPG.
    let bytes: Uint8Array;
    let ext: "webp" | "jpg" = "jpg";
    let contentType = "image/jpeg";
    const webp = await tryConvertToWebpViaFal(generatedUrl, FAL_KEY);
    if (webp) {
      bytes = webp.bytes;
      ext = "webp";
      contentType = webp.contentType;
    } else {
      const fileRes = await fetch(generatedUrl);
      if (!fileRes.ok) throw new Error(`Pobranie pliku FAL nieudane (${fileRes.status})`);
      contentType = fileRes.headers.get("content-type") ?? "image/jpeg";
      bytes = new Uint8Array(await fileRes.arrayBuffer());
      ext = contentType.includes("png") ? "jpg" : "jpg";
    }

    const path = `${data.enrichmentId}.${ext}`;

    // Wyczyść stare warianty (gdyby poprzednio był JPG, a teraz WebP itp.).
    await supabaseAdmin.storage
      .from("regenerated-images")
      .remove([`${data.enrichmentId}.webp`, `${data.enrichmentId}.jpg`])
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