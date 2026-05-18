import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "google/gemini-3-flash-preview";

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
  });
  return schema.parse(parsed);
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
      .select("id, project_id, nazwa, kod, ean")
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

    const systemPrompt = [
      "Jesteś ekspertem PIM. Twoim zadaniem jest stworzyć jeden, najlepszy 'Złoty Rekord' produktu na podstawie 1-3 źródeł internetowych.",
      "Twoja odpowiedź MUSI być poprawnym JSON-em o strukturze: {\"name\": string, \"description\": string}.",
      "Pisz po polsku. Opis powinien być rzeczowy, dobrze sformatowany (akapity, listy specyfikacji jeśli sensowne), 200-1500 znaków.",
      "NIE wymyślaj danych technicznych których nie ma w źródłach. NIE umieszczaj URL-i, nazw sklepów ani fraz typu 'kup teraz', 'dostawa', 'gwarancja'.",
      "Jeśli źródła się różnią - syntetyzuj wiarygodne wspólne fakty.",
    ].join("\n");

    const userPrompt = [
      `PRODUKT (z bazy klienta):`,
      `nazwa: ${product.nazwa ?? ""}`,
      `kod: ${product.kod ?? ""}`,
      `ean: ${product.ean ?? ""}`,
      "",
      `DODATKOWE INSTRUKCJE KLIENTA:`,
      customPrompt || "(brak)",
      "",
      `ŹRÓDŁA:`,
      sourceBlocks || "(brak)",
      "",
      `Wygeneruj JSON {\"name\", \"description\"}.`,
    ].join("\n");

    try {
      const out = await callGateway(apiKey, systemPrompt, userPrompt);
      const name = sanitize(out.name, blacklist);
      const description = sanitize(out.description, blacklist);

      const previous = enrichment.golden_name
        ? {
            name: enrichment.golden_name,
            description: enrichment.golden_description,
            at: enrichment.generated_at,
          }
        : null;

      const { error } = await supabase
        .from("enrichments")
        .update({
          status: "GENERATED",
          golden_name: name,
          golden_description: description,
          model: MODEL,
          generated_at: new Date().toISOString(),
          error: null,
          previous: previous as never,
        } as never)
        .eq("id", enrichment.id);
      if (error) throw new Error(error.message);
      return { ok: true, name, description };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("enrichments")
        .update({ status: "FAILED", error: msg } as never)
        .eq("id", enrichment.id);
      throw new Error(msg);
    }
  });