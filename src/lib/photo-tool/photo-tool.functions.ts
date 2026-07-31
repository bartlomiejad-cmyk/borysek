import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PhotoProject = {
  id: string;
  name: string;
  variants_per_product: number;
  style_prompt: string | null;
  requirements_pl: string | null;
  created_at: string;
  updated_at: string;
};

export type PhotoProductStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

export type PhotoProduct = {
  id: string;
  project_id: string;
  name: string | null;
  description: string | null;
  requirements_pl: string | null;
  source_image_url: string;
  source_image_urls: string[];
  thumbnail_url: string | null;
  lifestyle_urls: string[];
  status: PhotoProductStatus;
  last_error: string | null;
  generated_thumb_prompt: string | null;
  generated_lifestyle_prompt: string | null;
  created_at: string;
  updated_at: string;
};

function mapProduct(row: Record<string, unknown>): PhotoProduct {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: (row.name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    requirements_pl: (row.requirements_pl as string | null) ?? null,
    source_image_url: row.source_image_url as string,
    source_image_urls: Array.isArray(row.source_image_urls)
      ? (row.source_image_urls as string[])
      : (row.source_image_url ? [row.source_image_url as string] : []),
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    lifestyle_urls: Array.isArray(row.lifestyle_urls) ? (row.lifestyle_urls as string[]) : [],
    status: (row.status as PhotoProductStatus) ?? "PENDING",
    last_error: (row.last_error as string | null) ?? null,
    generated_thumb_prompt: (row.generated_thumb_prompt as string | null) ?? null,
    generated_lifestyle_prompt: (row.generated_lifestyle_prompt as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export const listPhotoProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("photo_projects" as never)
      .select("id, name, variants_per_product, style_prompt, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown) as PhotoProject[];
  });

export const createPhotoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ name: z.string().min(1).max(120) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("photo_projects" as never)
      .insert({ name: data.name, user_id: context.userId } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row as { id: string };
  });

export const deletePhotoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("photo_projects" as never).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updatePhotoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        variants_per_product: z.number().int().min(0).max(4).optional(),
        style_prompt: z.string().max(2000).nullable().optional(),
        requirements_pl: z.string().max(4000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("photo_projects" as never)
      .update(patch as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getPhotoProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("photo_projects" as never)
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Nie znaleziono projektu");
    const { data: products, error: pErr } = await context.supabase
      .from("photo_products" as never)
      .select("*")
      .eq("project_id", data.id)
      .order("created_at", { ascending: true });
    if (pErr) throw new Error(pErr.message);
    return {
      project: (project as unknown) as PhotoProject,
      products: ((products ?? []) as Record<string, unknown>[]).map(mapProduct),
    };
  });

export const addPhotoProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        name: z.string().max(400).optional().nullable(),
        description: z.string().max(8000).optional().nullable(),
        requirements_pl: z.string().max(4000).optional().nullable(),
        source_image_urls: z.array(z.string().url().max(2000)).min(1).max(50),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("photo_products" as never)
      .insert({
        project_id: data.projectId,
        user_id: context.userId,
        name: data.name ?? null,
        description: data.description ?? null,
        requirements_pl: data.requirements_pl?.trim() || null,
        source_image_url: data.source_image_urls[0],
        source_image_urls: data.source_image_urls,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row as { id: string };
  });

export const deletePhotoProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("photo_products" as never).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Per-product prompt override — lets the user write requirements for a single
// photo/product instead of relying only on the project-wide field.
export const updatePhotoProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().max(400).nullable().optional(),
        description: z.string().max(8000).nullable().optional(),
        requirements_pl: z.string().max(4000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("photo_products" as never)
      .update(patch as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Gemini Vision: propose per-photo requirements from the source images ---
export const suggestProductPromptFromImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        imageUrls: z.array(z.string().url().max(2000)).min(1).max(6),
        productName: z.string().max(400).optional(),
        currentText: z.string().max(4000).optional(),
        instruction: z.string().max(1000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Brak konfiguracji AI (LOVABLE_API_KEY)");

    const { data: project } = await context.supabase
      .from("photo_projects" as never)
      .select("id, name, style_prompt, requirements_pl")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project) throw new Error("Nie znaleziono projektu");
    const proj = project as { name?: string; style_prompt?: string | null; requirements_pl?: string | null };

    const system =
      "Jesteś dyrektorem artystycznym fotografii produktowej e-commerce. Piszesz po polsku. " +
      "Oglądasz zdjęcia KONKRETNEGO produktu i piszesz wytyczne dopasowane do tego, co widzisz (kategoria, materiał, kolor, kształt, sposób użycia). " +
      "Zwracasz WYŁĄCZNIE gotowy tekst do wklejenia w pole formularza — bez komentarzy, bez cudzysłowów, bez markdown. " +
      "2–5 zdań: osobno co ma być na MINIATURCE (packshot na białym tle) i osobno na WIZUALIZACJI (realistyczna scena użycia). " +
      "Produkt musi pozostać wierny oryginałowi: nie wymyślaj etykiet, logotypów ani zmian opakowania.";

    const textParts = [
      `PROJEKT: ${proj.name ?? "-"}`,
      data.productName?.trim() ? `NAZWA PRODUKTU: ${data.productName.trim()}` : "",
      proj.style_prompt?.trim() ? `STYL PROJEKTU: ${proj.style_prompt.trim()}` : "",
      proj.requirements_pl?.trim() ? `WYMAGANIA PROJEKTU (kontekst):\n${proj.requirements_pl.trim()}` : "",
      data.currentText?.trim() ? `AKTUALNA TREŚĆ POLA:\n${data.currentText.trim()}` : "",
      data.instruction?.trim()
        ? `POPRAW ZGODNIE Z INSTRUKCJĄ:\n${data.instruction.trim()}`
        : "Na podstawie zdjęć napisz wytyczne dla tego produktu.",
    ].filter(Boolean);

    const content: Array<Record<string, unknown>> = [
      { type: "text", text: textParts.join("\n\n") },
      ...data.imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Limit zapytań AI przekroczony — spróbuj za chwilę.");
    if (res.status === 402) throw new Error("Brak kredytów AI — doładuj w Ustawieniach.");
    if (!res.ok) throw new Error(`Błąd AI (${res.status}): ${(await res.text()).slice(0, 300)}`);

    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = (j.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("AI nie zwróciło treści — spróbuj ponownie.");
    return { text };
  });

// Queue a per-image edit job. The worker pipeline (bulk_jobs → dispatcher →
// runPhotoToolEditImage) does the actual FAL call so long requests never time
// out the browser, and progress shows up in the shared BulkJobLog.
export const editPhotoImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        photoProductId: z.string().uuid(),
        slot: z.enum(["thumbnail", "lifestyle"]),
        lifestyleIndex: z.number().int().min(0).max(20).optional(),
        requirementsPl: z.string().min(2).max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Look up the product to (a) confirm the user owns it via RLS and (b)
    // grab the project_id we need to queue the job under.
    const { data: prod, error: pErr } = await supabase
      .from("photo_products" as never)
      .select("id, project_id")
      .eq("id", data.photoProductId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prod) throw new Error("Nie znaleziono zdjęcia");
    const projectId = (prod as { project_id: string }).project_id;

    const { data: row, error } = await supabase
      .from("bulk_jobs" as never)
      .insert({
        project_id: projectId,
        user_id: userId,
        kind: "PHOTO_TOOL_EDIT_IMAGE",
        items: [data.photoProductId] as never,
        total: 1,
        payload: {
          slot: data.slot,
          lifestyleIndex: data.lifestyleIndex ?? 0,
          requirementsPl: data.requirementsPl,
        } as never,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Kick the worker immediately so the user doesn't wait for the next cron tick.
    try {
      const { kickBulkWorker } = await import("@/lib/pim/worker-kick.server");
      kickBulkWorker();
    } catch {
      // ignore — cron will pick it up
    }

    return { jobId: (row as { id: string }).id };
  });

// --- AI-assisted prompt fields -------------------------------------------
// Generates or refines the project-level "style/scene" and "requirements (PL)"
// texts. Returns a suggestion only; the user still saves it explicitly.
export const suggestPhotoPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        field: z.enum(["style", "requirements"]),
        mode: z.enum(["generate", "refine"]),
        currentText: z.string().max(4000).optional(),
        otherText: z.string().max(4000).optional(),
        instruction: z.string().max(1000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Brak konfiguracji AI (LOVABLE_API_KEY)");

    const { data: project, error: projErr } = await context.supabase
      .from("photo_projects" as never)
      .select("id, name")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projErr) throw new Error(projErr.message);
    if (!project) throw new Error("Nie znaleziono projektu");

    const { data: products } = await context.supabase
      .from("photo_products" as never)
      .select("name, description")
      .eq("project_id", data.projectId)
      .limit(10);

    const productLines = ((products ?? []) as Array<{ name?: string | null; description?: string | null }>)
      .map((p) => `- ${p.name ?? "(bez nazwy)"}${p.description ? `: ${p.description.slice(0, 300)}` : ""}`)
      .join("\n");

    const fieldDesc =
      data.field === "style"
        ? "POLE: „Styl / scena dla wizualizacji” — krótki opis scenerii, światła, tła i nastroju (1–3 zdania, po polsku). Bez list, bez nagłówków."
        : "POLE: „Wymagania (PL)” — konkretne wytyczne po polsku: osobno co ma być na MINIATURCE (packshot na białym tle) i osobno na WIZUALIZACJI (scena lifestyle). 2–5 zdań, konkretnie, bez marketingowego lania wody.";

    const system =
      "Jesteś dyrektorem artystycznym fotografii produktowej e-commerce. Piszesz po polsku. " +
      "Zwracasz WYŁĄCZNIE gotowy tekst do wklejenia w pole formularza — bez komentarzy, bez cudzysłowów, bez markdown. " +
      "Produkt musi pozostać wierny oryginałowi: nie wymyślaj etykiet, logotypów ani zmian opakowania.";

    const parts = [
      fieldDesc,
      `PROJEKT: ${(project as { name?: string }).name ?? "-"}`,
      productLines ? `PRODUKTY W PROJEKCIE:\n${productLines}` : "PRODUKTY: brak (projekt pusty)",
      data.otherText?.trim() ? `KONTEKST — drugie pole ustawień:\n${data.otherText.trim()}` : "",
      data.mode === "refine"
        ? `AKTUALNA TREŚĆ POLA:\n${data.currentText?.trim() || "(puste)"}\n\nPOPRAW ZGODNIE Z INSTRUKCJĄ:\n${data.instruction?.trim() || "popraw i doprecyzuj"}`
        : "Wygeneruj propozycję treści tego pola.",
    ].filter(Boolean);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: parts.join("\n\n") },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Limit zapytań AI przekroczony — spróbuj za chwilę.");
    if (res.status === 402) throw new Error("Brak kredytów AI — doładuj w Ustawieniach.");
    if (!res.ok) throw new Error(`Błąd AI (${res.status}): ${(await res.text()).slice(0, 300)}`);

    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = (j.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("AI nie zwróciło treści — spróbuj ponownie.");
    return { text };
  });