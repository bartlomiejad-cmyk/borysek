import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  sanitizeProductDescription,
  filterImageUrls,
  normalizeDomainToken,
  extractHostname,
} from "./source-cleanup";
import { llmCleanDescription, type CleaningMeta } from "./llm-cleaner.server";

const LLM_CLEAN_MIN_CHARS = 200;

type MatchType = "EAN_MATCH" | "NAME_MATCH" | "HYBRID_MATCH" | "NO_MATCH";

const VALIDATION_MODEL = "google/gemini-2.5-flash-lite";
const TOP_SOURCES_PER_PRODUCT = 5;

type SourceMeta = {
  title: string | null;
  description: string | null;
  imagesCount: number;
};

type ScoreResult = {
  total: number;
  producer_boost: boolean;
  trusted_boost: boolean;
};

function scoreSource(
  meta: SourceMeta,
  product: { nazwa: string | null; ean: string | null; producer: string | null },
  url: string,
  trustedDomains: string[],
): ScoreResult {
  const title = (meta.title ?? "").toLowerCase();
  const desc = (meta.description ?? "").toLowerCase();
  const descLen = desc.length;
  const imgs = meta.imagesCount;

  // Śmieciowe źródło: brak tytułu, brak sensownego opisu, brak zdjęć.
  if (!title && descLen < 40 && imgs === 0) {
    return { total: -5, producer_boost: false, trusted_boost: false };
  }

  let s = 0;
  if (descLen >= 200) s += 3;
  else if (descLen >= 40) s += 1;

  const nazwa = (product.nazwa ?? "").toLowerCase();
  const tokens = nazwa
    .split(/[\s,\-_/]+/)
    .filter((t) => t.length >= 3);
  if (title && tokens.some((t) => title.includes(t))) s += 2;

  s += Math.min(imgs, 3);

  const ean = (product.ean ?? "").trim();
  if (ean && (title.includes(ean) || desc.includes(ean))) s += 2;

  const host = extractHostname(url);
  const normHost = normalizeDomainToken(host);
  const normProducer = normalizeDomainToken(product.producer);
  let producer_boost = false;
  if (normProducer && normProducer.length >= 3 && normHost.includes(normProducer)) {
    s += 5;
    producer_boost = true;
  }

  let trusted_boost = false;
  if (host && trustedDomains.length) {
    for (const td of trustedDomains) {
      const t = td.trim().toLowerCase().replace(/^www\./, "");
      if (!t) continue;
      if (host === t || host.endsWith("." + t)) {
        s += 4;
        trusted_boost = true;
        break;
      }
    }
  }

  return { total: s, producer_boost, trusted_boost };
}

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

    // Zawsze: pobierz metadane źródeł, wyczyść opisy/obrazy i zastosuj
    // scoring + cap TOP N. AI-walidacja jest opcjonalna (wymaga LOVABLE_API_KEY).
    {
      const allUrls = Array.from(
        new Set(updates.flatMap((u) => u.picked_urls)),
      );
      const srcMap = new Map<string, { title: string | null; description: string | null }>();
      const metaMap = new Map<string, SourceMeta>();
      const productById = new Map(products.map((p) => [p.id, p]));
      const urlToProduct = new Map<string, { nazwa: string | null; ean: string | null }>();
      for (const u of updates) {
        const p = productById.get(u.source_product_id);
        if (!p) continue;
        for (const url of u.picked_urls) {
          if (!urlToProduct.has(url)) urlToProduct.set(url, { nazwa: p.nazwa, ean: p.ean });
        }
      }
      const CHUNK = 200;
      for (let i = 0; i < allUrls.length; i += CHUNK) {
        const chunk = allUrls.slice(i, i + CHUNK);
        const { data: rows } = await supabase
          .from("product_sources")
          .select("id, url, title, description, images, extra_images")
          .eq("project_id", data.projectId)
          .in("url", chunk);
        for (const r of rows ?? []) {
          const rr = r as {
            id: string;
            url: string;
            title: string | null;
            description: string | null;
            images: unknown;
            extra_images: unknown;
          };
          const descRaw = rr.description ?? "";
          const regexClean = sanitizeProductDescription(descRaw);
          let descClean = regexClean;
          let cleaningMeta: CleaningMeta = {
            cleaned_by: "regex",
            confidence: null,
            removed_sections: [],
          };
          if (regexClean.length > LLM_CLEAN_MIN_CHARS) {
            const ctx = urlToProduct.get(rr.url);
            const llm = await llmCleanDescription({
              rawHtml: descRaw,
              productName: ctx?.nazwa ?? null,
              ean: ctx?.ean ?? null,
            });
            descClean = llm.description || regexClean;
            cleaningMeta = llm.meta;
          }
          const mainIn = Array.isArray(rr.images) ? (rr.images as string[]) : [];
          const extraIn = Array.isArray(rr.extra_images) ? (rr.extra_images as string[]) : [];
          const mainClean = filterImageUrls(mainIn);
          const extraClean = filterImageUrls(extraIn);
          await supabase
            .from("product_sources")
            .update({
              description: descClean || null,
              images: mainClean as never,
              extra_images: extraClean as never,
              cleaning_meta: cleaningMeta as never,
            } as never)
            .eq("id", rr.id);
          srcMap.set(rr.url, {
            title: rr.title ?? null,
            description: descClean || null,
          });
          metaMap.set(rr.url, {
            title: rr.title ?? null,
            description: descClean || null,
            imagesCount: mainClean.length + extraClean.length,
          });
        }
      }
      let validated = 0;
      for (const u of updates) {
        if (!u.picked_urls.length) continue;
        const prod = productById.get(u.source_product_id);
        if (!prod || !prod.nazwa) continue;

        let kept = u.picked_urls;
        if (apiKey) {
          const sources = u.picked_urls
            .map((url) => ({
              url,
              title: srcMap.get(url)?.title ?? null,
              description: srcMap.get(url)?.description ?? null,
            }))
            .filter((s) => s.title || s.description);
          if (sources.length) {
            const keep = await validateSourcesWithAI(apiKey, prod.nazwa, prod.ean ?? null, sources);
            kept = u.picked_urls.filter((url) => keep.has(url));
            validated++;
          }
        }

        // Ranking po jakości danych i cap TOP N — źródła bez tytułu/opisu/zdjęć
        // wypadają, nawet jeśli AI je zaakceptowało.
        const ranked = kept
          .map((url) => {
            const meta = metaMap.get(url) ?? {
              title: null,
              description: null,
              imagesCount: 0,
            };
            return { url, score: scoreSource(meta, { nazwa: prod.nazwa, ean: prod.ean ?? null }) };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, TOP_SOURCES_PER_PRODUCT)
          .map((x) => x.url);

        const wasMatched = u.picked_urls.length > 0;
        if (ranked.length !== u.picked_urls.length) {
          u.picked_urls = ranked;
          if (!ranked.length) {
            u.status = "PENDING";
            u.match_type = "NO_MATCH";
            u.matched_term = null;
            if (wasMatched) matched--;
          }
        }
      }
      console.log(`[runMatching] scored+capped all products; AI-validated ${validated}`);
      if (!apiKey) console.warn("[runMatching] LOVABLE_API_KEY missing; skipping AI validation");
    }

    if (updates.length) {
      const { error } = await supabase
        .from("enrichments")
        .upsert(updates as never, { onConflict: "source_product_id" });
      if (error) throw new Error(error.message);
    }
    return { matched, total: products.length };
  });