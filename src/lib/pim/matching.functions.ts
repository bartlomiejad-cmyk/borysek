import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type MatchType = "EAN_MATCH" | "NAME_MATCH" | "HYBRID_MATCH" | "NO_MATCH";

const VALIDATION_MODEL = "google/gemini-2.5-flash-lite";

/**
 * Ask the AI to decide which source URLs actually describe the same product
 * as the client's product (by name). Returns a Set of URLs to KEEP.
 * If AI is unavailable or fails, falls back to keeping all URLs.
 */
async function validateSourcesWithAI(
  apiKey: string,
  productName: string,
  productEan: string | null,
  sources: Array<{ url: string; title: string | null; description: string | null }>,
): Promise<Set<string>> {
  if (!sources.length) return new Set();
  const blocks = sources
    .map((s, idx) => {
      const desc = (s.description ?? "").slice(0, 800);
      return `### ${idx + 1}\nURL: ${s.url}\nTYTUŁ: ${s.title ?? ""}\nOPIS: ${desc}`;
    })
    .join("\n\n");
  const system = [
    "Jesteś walidatorem dopasowań produktów w PIM.",
    "Dla podanego PRODUKTU oraz listy ŹRÓDEŁ (stron internetowych) zdecyduj, które źródła opisują DOKŁADNIE ten sam produkt (ten sam wariant, marka, model, rozmiar/gramatura).",
    "Bardzo restrykcyjnie: jeśli marka, model lub kluczowy wariant (np. nazwa serii, granulacja, kaliber, pojemność, kolor) różni się lub brakuje w źródle — odrzuć źródło.",
    "Brak frazy z nazwy produktu (np. nazwa marki) w tytule/URL/opisie źródła = źródło NIE pasuje.",
    "Zwróć JSON: {\"keep\": number[]} gdzie liczby to indeksy źródeł (1-based) które pasują. Jeśli żadne nie pasuje, zwróć {\"keep\": []}.",
  ].join("\n");
  const user = [
    `PRODUKT: ${productName}`,
    productEan ? `EAN: ${productEan}` : "",
    "",
    "ŹRÓDŁA:",
    blocks,
  ].filter(Boolean).join("\n");
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: VALIDATION_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(`validateSourcesWithAI: gateway ${res.status}; keeping all`);
      return new Set(sources.map((s) => s.url));
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { keep?: unknown };
    const idxs = Array.isArray(parsed.keep)
      ? parsed.keep.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      : [];
    const kept = new Set<string>();
    for (const i of idxs) {
      const s = sources[i - 1];
      if (s) kept.add(s.url);
    }
    return kept;
  } catch (e) {
    console.warn("validateSourcesWithAI failed; keeping all:", e);
    return new Set(sources.map((s) => s.url));
  }
}

export const runMatching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("strategy")
      .eq("id", data.projectId)
      .single();
    if (pErr || !project) throw new Error(pErr?.message ?? "Project not found");
    const strategy = project.strategy as "EAN" | "NAZWA" | "HYBRID";

    const [{ data: products }, { data: searches }] = await Promise.all([
      supabase
        .from("source_products")
        .select("id, nazwa, ean")
        .eq("project_id", data.projectId),
      supabase
        .from("search_results")
        .select("term, organic_urls")
        .eq("project_id", data.projectId),
    ]);
    if (!products || !searches) return { matched: 0 };

    const termMap = new Map<string, string[]>();
    for (const s of searches) {
      const urls = Array.isArray(s.organic_urls)
        ? (s.organic_urls as unknown[]).filter((u): u is string => typeof u === "string")
        : [];
      termMap.set(s.term.trim().toLowerCase(), urls);
    }

    const lookup = (term: string | null) =>
      term ? termMap.get(term.trim().toLowerCase()) ?? null : null;

    let matched = 0;
    const updates: Array<{
      source_product_id: string;
      project_id: string;
      status: "MATCHED" | "PENDING";
      match_type: MatchType;
      matched_term: string | null;
      picked_urls: string[];
    }> = [];

    for (const p of products) {
      let mtype: MatchType = "NO_MATCH";
      let urls: string[] | null = null;
      let term: string | null = null;

      if (strategy === "EAN" && p.ean) {
        urls = lookup(p.ean);
        if (urls) { mtype = "EAN_MATCH"; term = p.ean; }
      } else if (strategy === "NAZWA" && p.nazwa) {
        urls = lookup(p.nazwa);
        if (urls) { mtype = "NAME_MATCH"; term = p.nazwa; }
      } else if (strategy === "HYBRID") {
        if (p.nazwa && p.ean) {
          const hyb = `${p.nazwa} ${p.ean}`;
          urls = lookup(hyb);
          if (urls) { mtype = "HYBRID_MATCH"; term = hyb; }
        }
        if (!urls && p.ean) {
          urls = lookup(p.ean);
          if (urls) { mtype = "EAN_MATCH"; term = p.ean; }
        }
        if (!urls && p.nazwa) {
          urls = lookup(p.nazwa);
          if (urls) { mtype = "NAME_MATCH"; term = p.nazwa; }
        }
      }

      // Keep ALL matched URLs — downstream views (list + detail) need access to
      // images from every source, not just the first 3.
      const picked = Array.from(new Set((urls ?? []).filter((u) => typeof u === "string" && u.length > 0)));
      if (picked.length) matched++;
      updates.push({
        source_product_id: p.id,
        project_id: data.projectId,
        status: picked.length ? "MATCHED" : "PENDING",
        match_type: mtype,
        matched_term: term,
        picked_urls: picked,
      });
    }

    // AI validation pass: drop sources that don't actually describe the same
    // product (e.g. missing the key brand token like "SWISS").
    if (apiKey) {
      const allUrls = Array.from(
        new Set(updates.flatMap((u) => u.picked_urls)),
      );
      const srcMap = new Map<string, { title: string | null; description: string | null }>();
      const CHUNK = 200;
      for (let i = 0; i < allUrls.length; i += CHUNK) {
        const chunk = allUrls.slice(i, i + CHUNK);
        const { data: rows } = await supabase
          .from("product_sources")
          .select("url, title, description")
          .eq("project_id", data.projectId)
          .in("url", chunk);
        for (const r of rows ?? []) {
          srcMap.set(r.url, {
            title: (r as { title?: string | null }).title ?? null,
            description: (r as { description?: string | null }).description ?? null,
          });
        }
      }
      const productById = new Map(products.map((p) => [p.id, p]));
      let validated = 0;
      // Sequential to respect rate limits; only validate rows with 1+ URLs.
      for (const u of updates) {
        if (!u.picked_urls.length) continue;
        const prod = productById.get(u.source_product_id);
        if (!prod || !prod.nazwa) continue;
        const sources = u.picked_urls
          .map((url) => ({
            url,
            title: srcMap.get(url)?.title ?? null,
            description: srcMap.get(url)?.description ?? null,
          }))
          .filter((s) => s.title || s.description);
        if (!sources.length) continue;
        const keep = await validateSourcesWithAI(apiKey, prod.nazwa, prod.ean ?? null, sources);
        const kept = u.picked_urls.filter((url) => keep.has(url));
        if (kept.length !== u.picked_urls.length) {
          u.picked_urls = kept;
          if (!kept.length) {
            u.status = "PENDING";
            u.match_type = "NO_MATCH";
            u.matched_term = null;
            matched--;
          }
        }
        validated++;
      }
      console.log(`[runMatching] AI-validated ${validated} products`);
    } else {
      console.warn("[runMatching] LOVABLE_API_KEY missing; skipping AI validation");
    }

    if (updates.length) {
      const { error } = await supabase
        .from("enrichments")
        .upsert(updates as never, { onConflict: "source_product_id" });
      if (error) throw new Error(error.message);
    }
    return { matched, total: products.length };
  });