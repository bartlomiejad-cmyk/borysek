import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FAL_BASE = "https://fal.run";

type FalImage = { url: string; content_type?: string };
type FalResp = { images?: FalImage[]; image?: FalImage };

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
    throw new Error(`FAL ${path} ${res.status}: ${txt.slice(0, 400)}`);
  }
  return (await res.json()) as FalResp;
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
          "Place the product on a clean pure white seamless studio background with a soft natural shadow underneath. Keep the product centered, occupying about 70% of the frame with even margins around it. Professional e-commerce product photography, sharp focus, high detail, accurate colors, no text, no extra objects.",
        image_size: { width: 2560, height: 2560 },
        num_images: 1,
        sync_mode: true,
        enable_safety_checker: true,
      },
      FAL_KEY,
    );
    const generatedUrl = shot.images?.[0]?.url;
    if (!generatedUrl) throw new Error("FAL nie zwróciło zdjęcia");

    // Step 2 — konwersja do WebP 2560x2560. Jeśli image-conversion nie zadziała,
    // wracamy do surowego outputu bria (JPEG) — nie blokuje użytkownika.
    let finalUrl = generatedUrl;
    let ext: "webp" | "jpg" = "jpg";
    let contentType = "image/jpeg";
    try {
      const conv = await callFal(
        "fal-ai/imageutils/image-conversion",
        {
          image_url: generatedUrl,
          format: "webp",
          width: 2560,
          height: 2560,
          sync_mode: true,
        },
        FAL_KEY,
      );
      const convUrl = conv.image?.url ?? conv.images?.[0]?.url;
      if (convUrl) {
        finalUrl = convUrl;
        ext = "webp";
        contentType = "image/webp";
      }
    } catch (e) {
      console.warn("[regen] image-conversion failed, falling back to bria output", e);
    }

    // Step 3 — pobierz bajty i wgraj do publicznego bucketu.
    const fileRes = await fetch(finalUrl);
    if (!fileRes.ok) throw new Error(`Pobranie pliku FAL nieudane (${fileRes.status})`);
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
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
      .update({ regenerated_main_image: publicUrl } as never)
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
    const { error } = await context.supabase
      .from("enrichments")
      .update({ regenerated_main_image: null } as never)
      .eq("id", data.enrichmentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });