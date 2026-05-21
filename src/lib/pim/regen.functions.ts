import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { simd } from "wasm-feature-detect";
// WASM modules — imported directly so workerd bundles them at build time.
// (Dynamic fetch of .wasm at runtime is not supported in the Worker.)
// @ts-expect-error — Vite may return either a URL string or WebAssembly.Module depending on runtime.
import JPEG_DEC_WASM from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
// @ts-expect-error
import PNG_WASM from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
// @ts-expect-error
import WEBP_ENC_WASM from "@jsquash/webp/codec/enc/webp_enc.wasm";
// @ts-expect-error
import WEBP_ENC_SIMD_WASM from "@jsquash/webp/codec/enc/webp_enc_simd.wasm";

const FAL_BASE = "https://fal.run";

type FalImage = { url: string; content_type?: string };
type FalResp = { images?: FalImage[]; image?: FalImage };
type WasmImport = WebAssembly.Module | string;

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

async function convertToWebp(
  bytes: Uint8Array,
  contentType: string,
): Promise<Uint8Array> {
  const [jpegMod, pngMod, webpMod] = await Promise.all([
    import("@jsquash/jpeg/decode"),
    import("@jsquash/png/decode"),
    import("@jsquash/webp/encode"),
  ]);
  const [jpegWasm, pngWasm, webpWasm] = await Promise.all([
    resolveWasmModule(JPEG_DEC_WASM as WasmImport),
    resolveWasmModule(PNG_WASM as WasmImport),
    simd().then((supported) =>
      resolveWasmModule((supported ? WEBP_ENC_SIMD_WASM : WEBP_ENC_WASM) as WasmImport),
    ),
  ]);
  await Promise.all([
    jpegMod.init(jpegWasm),
    pngMod.init(pngWasm),
    webpMod.init(webpWasm),
  ]);

  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let img: ImageData;
  const isPng = contentType.includes("png");
  try {
    img = isPng ? await pngMod.default(ab) : await jpegMod.default(ab);
  } catch {
    // Try the other decoder as a fallback.
    img = isPng ? await jpegMod.default(ab) : await pngMod.default(ab);
  }

  const out = await webpMod.default(img, { quality: 88 });
  return new Uint8Array(out);
}

async function resolveWasmModule(wasm: WasmImport): Promise<WebAssembly.Module> {
  if (wasm instanceof WebAssembly.Module) return wasm;
  if (wasm.startsWith("data:")) return new WebAssembly.Module(dataUrlToArrayBuffer(wasm));

  const base = wasm.startsWith("http")
    ? undefined
    : `http://localhost:${process.env.PORT ?? "8080"}`;
  const res = await fetch(base ? new URL(wasm, base) : wasm);
  if (!res.ok) throw new Error(`Nie udało się załadować WASM (${res.status})`);
  return new WebAssembly.Module(await res.arrayBuffer());
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const [, payload = ""] = dataUrl.split(",", 2);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
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

    // Step 2 — pobierz oryginał z FAL.
    const fileRes = await fetch(generatedUrl);
    if (!fileRes.ok) throw new Error(`Pobranie pliku FAL nieudane (${fileRes.status})`);
    const srcContentType = fileRes.headers.get("content-type") ?? "image/jpeg";
    const srcBytes = new Uint8Array(await fileRes.arrayBuffer());

    // Step 3 — konwersja do WebP 2560x2560 po naszej stronie (WASM).
    // W razie awarii WASM wracamy do surowego JPEG, żeby nie blokować użytkownika.
    let bytes: Uint8Array = srcBytes;
    let ext: "webp" | "jpg" = "jpg";
    let contentType = srcContentType;
    try {
      bytes = await convertToWebp(srcBytes, srcContentType);
      ext = "webp";
      contentType = "image/webp";
    } catch (e) {
      console.warn("[regen] local webp conversion failed, uploading source bytes", e);
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