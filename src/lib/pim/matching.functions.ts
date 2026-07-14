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
import { advancePipelineStatus } from "./pipeline-status";

const LLM_CLEAN_MIN_CHARS = 200;

type MatchType = "EAN_MATCH" | "NAME_MATCH" | "HYBRID_MATCH" | "NO_MATCH";

const VALIDATION_MODEL = "google/gemini-2.5-flash-lite";
const TOP_SOURCES_PER_PRODUCT = 5;

// Minimum score a source needs to count as "strong evidence" for the product.
// A source with a 200+ char description AND one matching signal (title/EAN/img)
// clears this bar. Used by the adaptive rescrape trigger.
export const SOURCE_SCORE_THRESHOLD = 4;
export const MIN_STRONG_SOURCES = 3;
export const MAX_RESCRAPE_ROUNDS = 2;

type SourceMeta = {
  title: string | null;
  description: string | null;
  imagesCount: number;
};

/**
 * True when the product's EAN (or its zero-stripped form) can be found inside
 * the source's title, description or URL. Comparison is done on digit-only
 * strings so separators (spaces, dashes, dots) don't hide a match.
 */
export function eanConfirmedFor(
  productEan: string | null | undefined,
  meta: { title: string | null; description: string | null },
  url: string,
): boolean {
  const digits = (productEan ?? "").replace(/\D/g, "");
  if (digits.length < 6) return false;
  const stripped = digits.replace(/^0+/, "");
  const hay = ((meta.title ?? "") + " " + (meta.description ?? "") + " " + (url ?? "")).replace(
    /\D/g,
    "",
  );
  if (!hay) return false;
  if (hay.includes(digits)) return true;
  if (stripped.length >= 6 && hay.includes(stripped)) return true;
  return false;
}

type ScoreResult = {
  total: number;
  producer_boost: boolean;
  trusted_boost: boolean;
  ean_confirmed: boolean;
};

type ValidationResult = {
  keep: Set<string>;
  clustersByUrl: Map<string, string>;
  ok: boolean;
};

type BreakdownEntry = {
  url: string;
  total: number;
  producer_boost: boolean;
  trusted_boost: boolean;
  variant_key: string | null;
  deduped: boolean;
  ean_confirmed?: boolean;
  manual?: boolean;
};

/**
 * Heuristic: does this product name look like an accessory / replacement /
 * compatibility item (e.g. filters, seals, spare parts)? Used to prompt the
 * user to switch to compatibility matching mode when strict validation
 * rejects every source.
 */
export function isLikelyCompatProduct(name: string | null | undefined): boolean {
  if (!name) return false;
  const t = name.toLowerCase();
  if (/\bpasuje\s+do\b/.test(t)) return true;
  if (/\bzamiennik(i|em|ów|ow)?\b/.test(t)) return true;
  if (/\bakcesori(a|um|ów|ow)?\b/.test(t)) return true;
  if (/\bkomplet\s+filtr/.test(t)) return true;
  if (/\bdo\s+rekuperator/.test(t)) return true;
  // "do modelA/modelB/modelC" — three+ slash- or space-separated model tokens after "do "
  if (/\bdo\s+[\wąćęłńóśźż0-9]{2,}[\s/,][\wąćęłńóśźż0-9]{2,}[\s/,][\wąćęłńóśźż0-9]{2,}/i.test(name)) return true;
  // three+ slash/comma-separated tokens anywhere (350H/2 350V/2 355 Combo ...)
  const slashSep = name.split(/[\/,;|]/).map((s) => s.trim()).filter((s) => s.length >= 2);
  if (slashSep.length >= 3) return true;
  return false;
}

/**
 * Given a set of URLs allowed to be picked, apply variant-cluster dedup.
 * Within each cluster keep only the best URL (score, then cleaning confidence,
 * then description length). Returns dedup outcome per URL.
 */
function applyClusterDedup(
  urls: string[],
  scoreByUrl: Map<string, number>,
  clustersByUrl: Map<string, string>,
  confidenceByUrl: Map<string, number | null>,
  descLenByUrl: Map<string, number>,
): { keptUrls: Set<string>; deduped: Set<string>; keyByUrl: Map<string, string | null> } {
  const buckets = new Map<string, string[]>();
  const keyByUrl = new Map<string, string | null>();
  const unclustered: string[] = [];
  for (const u of urls) {
    const k = clustersByUrl.get(u);
    if (!k) {
      keyByUrl.set(u, null);
      unclustered.push(u);
      continue;
    }
    keyByUrl.set(u, k);
    const arr = buckets.get(k) ?? [];
    arr.push(u);
    buckets.set(k, arr);
  }
  const keptUrls = new Set<string>(unclustered);
  const deduped = new Set<string>();
  for (const [, arr] of buckets) {
    if (arr.length === 1) { keptUrls.add(arr[0]); continue; }
    const winner = arr.slice().sort((a, b) => {
      const sa = scoreByUrl.get(a) ?? 0;
      const sb = scoreByUrl.get(b) ?? 0;
      if (sb !== sa) return sb - sa;
      const ca = confidenceByUrl.get(a) ?? -1;
      const cb = confidenceByUrl.get(b) ?? -1;
      if ((cb ?? -1) !== (ca ?? -1)) return (cb ?? -1) - (ca ?? -1);
      return (descLenByUrl.get(b) ?? 0) - (descLenByUrl.get(a) ?? 0);
    })[0];
    keptUrls.add(winner);
    for (const u of arr) if (u !== winner) deduped.add(u);
  }
  return { keptUrls, deduped, keyByUrl };
}

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
    return { total: -5, producer_boost: false, trusted_boost: false, ean_confirmed: false };
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

  const ean_confirmed = eanConfirmedFor(product.ean, meta, url);
  if (ean_confirmed) s += 8;

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

  return { total: s, producer_boost, trusted_boost, ean_confirmed };
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
  sources: Array<{
    url: string;
    title: string | null;
    description: string | null;
    ean?: string | null;
    mpn?: string | null;
  }>,
  mode: "strict" | "compatible" = "strict",
): Promise<ValidationResult> {
  if (!sources.length) return { keep: new Set(), clustersByUrl: new Map(), ok: true };
  const blocks = sources
    .map((s, idx) => {
      const desc = (s.description ?? "").slice(0, 1500);
      const lines = [
        `### ${idx + 1}`,
        `URL: ${s.url}`,
        `TYTUŁ: ${s.title ?? ""}`,
      ];
      if (s.ean && s.ean.trim()) lines.push(`EAN ŹRÓDŁA: ${s.ean.trim()}`);
      if (s.mpn && s.mpn.trim()) lines.push(`MPN ŹRÓDŁA: ${s.mpn.trim()}`);
      lines.push(`OPIS: ${desc}`);
      return lines.join("\n");
    })
    .join("\n\n");
  const strictSystem = [
    "Jesteś walidatorem dopasowań produktów w PIM.",
    "Dla podanego PRODUKTU oraz listy ŹRÓDEŁ (stron internetowych) zdecyduj, które źródła opisują DOKŁADNIE ten sam produkt (ten sam wariant, marka, model, rozmiar/gramatura).",
    "REGUŁA NADRZĘDNA: jeżeli w danych źródła występuje EAN identyczny z EAN produktu, źródło PASUJE — zaakceptuj je niezależnie od pozostałych heurystyk (nadal przypisz je do właściwego klastra wariantu).",
    "Bardzo restrykcyjnie: jeśli marka, model lub kluczowy wariant (np. nazwa serii, granulacja, kaliber, pojemność, kolor) różni się lub brakuje w źródle — odrzuć źródło.",
    "Brak jakiejkolwiek frazy z nazwy produktu w tytule/URL/opisie jest silnym sygnałem ostrzegawczym — odrzuć, CHYBA ŻE inne sygnały (zgodny EAN, zgodny kod producenta/MPN, zgodna kombinacja marka+model w URL) potwierdzają dopasowanie.",
    "Następnie POGRUPUJ zaakceptowane źródła w klastry, gdzie jeden klaster = DOKŁADNIE ten sam wariant fizyczny produktu (te same rozmiar/kolor/gramatura/kaliber).",
    "Różne rozmiary/kolory tego samego modelu = RÓŻNE klastry. Te same wariant z różnych sklepów = TEN SAM klaster.",
    "variant_key: string w formacie \"marka|model|wariant\" małymi literami, np. \"nike|air max 90|white 42\". Gdy wariant nieznany, użyj \"-\".",
    "Zwróć JSON: {\"keep\": number[], \"clusters\": [{\"variant_key\": string, \"indices\": number[]}]}. Indeksy 1-based. Każdy indeks z keep musi wystąpić w dokładnie jednym klastrze.",
    "Jeśli żadne nie pasuje: {\"keep\": [], \"clusters\": []}.",
  ].join("\n");
  const compatSystem = [
    "Jesteś walidatorem dopasowań produktów typu AKCESORIUM / ZAMIENNIK w PIM.",
    "Produkt to akcesorium/zamiennik (np. filtry do rekuperatora, uszczelki, części zamienne).",
    "Źródło PASUJE, jeżeli opisuje produkt funkcjonalnie równoważny: ten sam TYP (np. komplet filtrów M5+G4, konkretny typ uszczelki), zgodne kluczowe parametry (klasy filtracji, wymiary jeśli podane) ORAZ pokrywająca się lista kompatybilnych modeli/urządzeń (wystarczy część wspólna z modelami wymienionymi w nazwie produktu klienta).",
    "Inna marka zamiennika lub inny sklep NIE dyskwalifikuje źródła.",
    "Odrzuć TYLKO: inny typ produktu, inne klasy/parametry techniczne, brak wspólnych modeli kompatybilności.",
    "Klastruj po zestawie kompatybilności + typie, nie po marce. variant_key w formacie \"typ|parametry|kompatybilność\" małymi literami (np. \"filtr|m5+g4|wanas-350h-350v\"). Gdy brak informacji, użyj \"-\".",
    "Zwróć JSON: {\"keep\": number[], \"clusters\": [{\"variant_key\": string, \"indices\": number[]}]}. Indeksy 1-based. Każdy indeks z keep musi wystąpić w dokładnie jednym klastrze.",
    "Jeśli żadne nie pasuje: {\"keep\": [], \"clusters\": []}.",
  ].join("\n");
  const system = mode === "compatible" ? compatSystem : strictSystem;
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
      console.warn(`[matching] validateSourcesWithAI: gateway ${res.status}; keeping all, no clustering`);
      return { keep: new Set(sources.map((s) => s.url)), clustersByUrl: new Map(), ok: false };
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { keep?: unknown; clusters?: unknown };
    const idxs = Array.isArray(parsed.keep)
      ? parsed.keep.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      : [];
    const kept = new Set<string>();
    for (const i of idxs) {
      const s = sources[i - 1];
      if (s) kept.add(s.url);
    }
    const clustersByUrl = new Map<string, string>();
    let clustersOk = true;
    if (!Array.isArray(parsed.clusters)) {
      clustersOk = false;
    } else {
      for (const c of parsed.clusters as unknown[]) {
        if (!c || typeof c !== "object") { clustersOk = false; break; }
        const cc = c as { variant_key?: unknown; indices?: unknown };
        if (typeof cc.variant_key !== "string" || !Array.isArray(cc.indices)) {
          clustersOk = false; break;
        }
        const key = (cc.variant_key as string).trim().toLowerCase();
        if (!key) continue;
        for (const ix of cc.indices as unknown[]) {
          if (typeof ix !== "number") continue;
          const s = sources[ix - 1];
          if (s && kept.has(s.url)) clustersByUrl.set(s.url, key);
        }
      }
    }
    if (!clustersOk) {
      console.warn("[matching] validateSourcesWithAI: clusters schema invalid; skipping dedup");
      return { keep: kept, clustersByUrl: new Map(), ok: false };
    }
    return { keep: kept, clustersByUrl, ok: true };
  } catch (e) {
    console.warn("[matching] validateSourcesWithAI failed; keeping all, no clustering:", e);
    return { keep: new Set(sources.map((s) => s.url)), clustersByUrl: new Map(), ok: false };
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
      .select("strategy, settings")
      .eq("id", data.projectId)
      .single();
    if (pErr || !project) throw new Error(pErr?.message ?? "Project not found");
    const strategy = project.strategy as "EAN" | "NAZWA" | "HYBRID";
    const rawSettings = ((project as { settings?: unknown }).settings ?? {}) as Record<string, unknown>;
    const trustedDomains = Array.isArray(rawSettings.trusted_domains)
      ? (rawSettings.trusted_domains as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];

    const [{ data: products }, { data: searches }] = await Promise.all([
      supabase
        .from("source_products")
        .select("id, nazwa, ean, raw, manual_lock, matching_mode")
        .eq("project_id", data.projectId),
      supabase
        .from("search_results")
        .select("term, organic_urls")
        .eq("project_id", data.projectId),
    ]);
    if (!products || !searches) return { matched: 0 };
    const lockedSet = new Set<string>(
      (products as Array<{ id: string; manual_lock?: boolean | null }>)
        .filter((p) => !!p.manual_lock)
        .map((p) => p.id),
    );
    const modeById = new Map<string, "strict" | "compatible">(
      (products as Array<{ id: string; matching_mode?: string | null }>).map((p) => [
        p.id,
        ((p.matching_mode as string | null) === "compatible" ? "compatible" : "strict") as "strict" | "compatible",
      ]),
    );

    // Load existing enrichments to preserve manual sources (score_breakdown
    // entries flagged { manual: true }) and existing compat_suggested flags.
    const productIds = (products as Array<{ id: string }>).map((p) => p.id);
    const { data: existingEnRows } = productIds.length
      ? await supabase
          .from("enrichments")
          .select("source_product_id, picked_urls, score_breakdown, compat_suggested")
          .eq("project_id", data.projectId)
          .in("source_product_id", productIds)
      : { data: [] as unknown[] };
    const manualByProduct = new Map<string, string[]>();
    const manualBreakdownByProduct = new Map<string, BreakdownEntry[]>();
    for (const r of (existingEnRows ?? []) as Array<{
      source_product_id: string;
      picked_urls: string[] | null;
      score_breakdown: unknown;
    }>) {
      const bd = Array.isArray(r.score_breakdown) ? (r.score_breakdown as BreakdownEntry[]) : [];
      const manualEntries = bd.filter((b) => b && (b as { manual?: boolean }).manual === true);
      if (manualEntries.length) {
        manualByProduct.set(r.source_product_id, manualEntries.map((e) => e.url));
        manualBreakdownByProduct.set(r.source_product_id, manualEntries);
      }
    }

    const extractProducer = (raw: unknown): string | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const ie = r.imported_extract;
      if (ie && typeof ie === "object") {
        const p = (ie as Record<string, unknown>).producent;
        if (typeof p === "string" && p.trim()) return p.trim();
      }
      const direct = r.producent ?? r.producer ?? r.brand ?? r.marka;
      if (typeof direct === "string" && direct.trim()) return direct.trim();
      return null;
    };
    const producerById = new Map<string, string | null>(
      products.map((p) => [p.id, extractProducer((p as { raw?: unknown }).raw)]),
    );

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
      score_breakdown?: BreakdownEntry[];
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
      const raw = (urls ?? []).filter((u) => typeof u === "string" && u.length > 0);
      // Union with manual sources — they must never be dropped by rematch.
      const manualUrls = manualByProduct.get(p.id) ?? [];
      const picked = Array.from(new Set([...manualUrls, ...raw]));
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
      const confidenceMap = new Map<string, number | null>();
      const descLenMap = new Map<string, number>();
      const productById = new Map(products.map((p) => [p.id, p]));
      // Load pinned_main_url per product so we can skip clustering on manually-pinned products.
      const { data: pinRows } = await supabase
        .from("enrichments")
        .select("source_product_id, pinned_main_url")
        .eq("project_id", data.projectId)
        .in("source_product_id", updates.map((u) => u.source_product_id));
      const pinnedByProduct = new Map<string, string | null>();
      for (const r of pinRows ?? []) {
        const rr = r as { source_product_id: string; pinned_main_url: string | null };
        pinnedByProduct.set(rr.source_product_id, rr.pinned_main_url);
      }
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
          confidenceMap.set(rr.url, cleaningMeta.confidence ?? null);
          descLenMap.set(rr.url, (descClean ?? "").length);
        }
      }
      let validated = 0;
      for (const u of updates) {
        if (!u.picked_urls.length) continue;
        const prod = productById.get(u.source_product_id);
        if (!prod || !prod.nazwa) continue;

        let kept = u.picked_urls;
        let clustersByUrl = new Map<string, string>();
        const skipClustering = !!pinnedByProduct.get(u.source_product_id);
        const mode = modeById.get(u.source_product_id) ?? "strict";
        if (apiKey) {
          const sources = u.picked_urls
            .map((url) => ({
              url,
              title: srcMap.get(url)?.title ?? null,
              description: srcMap.get(url)?.description ?? null,
            }))
            .filter((s) => s.title || s.description);
          if (sources.length) {
            const val = await validateSourcesWithAI(apiKey, prod.nazwa, prod.ean ?? null, sources, mode);
            kept = u.picked_urls.filter((url) => val.keep.has(url));
            if (!skipClustering && val.ok) clustersByUrl = val.clustersByUrl;
            validated++;
          }
        }

        // Always preserve manual URLs regardless of AI validation outcome.
        const manualUrls = manualByProduct.get(u.source_product_id) ?? [];
        if (manualUrls.length) {
          const set = new Set(kept);
          for (const m of manualUrls) set.add(m);
          kept = Array.from(set);
        }

        // Ranking po jakości danych i cap TOP N — źródła bez tytułu/opisu/zdjęć
        // wypadają, nawet jeśli AI je zaakceptowało.
        const producer = producerById.get(u.source_product_id) ?? null;
        const scored = kept.map((url) => {
          const meta = metaMap.get(url) ?? {
            title: null,
            description: null,
            imagesCount: 0,
          };
          const r = scoreSource(
            meta,
            { nazwa: prod.nazwa, ean: prod.ean ?? null, producer },
            url,
            trustedDomains,
          );
          return { url, ...r };
        });
        const positive = scored.filter((x) => x.total > 0);
        const scoreByUrl = new Map(positive.map((x) => [x.url, x.total]));
        const dedup = applyClusterDedup(
          positive.map((x) => x.url),
          scoreByUrl,
          clustersByUrl,
          confidenceMap,
          descLenMap,
        );
        const rankedFull = positive
          .filter((x) => dedup.keptUrls.has(x.url))
          .sort((a, b) => {
            // EAN-confirmed sources always rank above non-confirmed.
            const ea = a.ean_confirmed ? 1 : 0;
            const eb = b.ean_confirmed ? 1 : 0;
            if (ea !== eb) return eb - ea;
            return b.total - a.total;
          })
          .slice(0, TOP_SOURCES_PER_PRODUCT);
        const ranked = rankedFull.map((x) => x.url);
        const winners: BreakdownEntry[] = rankedFull.map((x) => ({
          url: x.url,
          total: x.total,
          producer_boost: x.producer_boost,
          trusted_boost: x.trusted_boost,
          variant_key: dedup.keyByUrl.get(x.url) ?? null,
          deduped: false,
          ean_confirmed: x.ean_confirmed,
        }));
        const droppedByDedup: BreakdownEntry[] = positive
          .filter((x) => dedup.deduped.has(x.url))
          .map((x) => ({
            url: x.url,
            total: x.total,
            producer_boost: x.producer_boost,
            trusted_boost: x.trusted_boost,
            variant_key: dedup.keyByUrl.get(x.url) ?? null,
            deduped: true,
            ean_confirmed: x.ean_confirmed,
          }));
        u.score_breakdown = [...winners, ...droppedByDedup];

        // Merge manual breakdown entries so they survive the rescore and stay
        // marked as { manual: true } for UI badges.
        const manualBd = manualBreakdownByProduct.get(u.source_product_id) ?? [];
        if (manualBd.length) {
          const existingUrls = new Set(u.score_breakdown.map((b) => b.url));
          const injected: BreakdownEntry[] = [];
          for (const m of manualBd) {
            if (!existingUrls.has(m.url)) {
              injected.push({ ...m, manual: true });
            } else {
              // Ensure manual flag stays on already-scored URL.
              const cur = u.score_breakdown.find((b) => b.url === m.url);
              if (cur) (cur as BreakdownEntry).manual = true;
            }
          }
          if (injected.length) u.score_breakdown = [...u.score_breakdown, ...injected];
          // Ensure ranked list includes manual URLs at the top.
          const rankedSet = new Set(u.picked_urls);
          const manualHead = manualUrls.filter((m) => !rankedSet.has(m));
          if (manualHead.length) {
            u.picked_urls = [...manualHead, ...u.picked_urls];
            if (u.status === "PENDING") {
              u.status = "MATCHED";
              matched++;
            }
          }
        }

        // Auto-suggestion: strict mode dropped all candidates + name looks
        // like an accessory/replacement → flag compat_suggested.
        if (
          mode === "strict" &&
          u.picked_urls.length === 0 &&
          isLikelyCompatProduct(prod.nazwa)
        ) {
          try {
            await supabase
              .from("enrichments")
              .update({ compat_suggested: true } as never)
              .eq("source_product_id", u.source_product_id);
          } catch {
            /* non-fatal */
          }
        } else if (u.picked_urls.length > 0) {
          // Clear stale hint once we have matches again.
          try {
            await supabase
              .from("enrichments")
              .update({ compat_suggested: false } as never)
              .eq("source_product_id", u.source_product_id);
          } catch {
            /* non-fatal */
          }
        }

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
      // Manually-locked products keep their existing picked_urls untouched.
      const writable = updates.filter((u) => !lockedSet.has(u.source_product_id));
      const { error } = writable.length
        ? await supabase
        .from("enrichments")
        .upsert(writable as never, { onConflict: "source_product_id" })
        : { error: null as unknown as { message: string } | null };
      if (error) throw new Error(error.message);
      // Forward-only advance for products that ended up with picked sources.
      for (const u of updates) {
        if (u.picked_urls.length > 0) {
          await advancePipelineStatus(supabase as never, u.source_product_id, "MATCHED");
        }
      }
      // Timeline event per product — best-effort, never blocks matching.
      try {
        const { logProductEvent } = await import("./product-events.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        for (const u of updates) {
          const eanConfirmed = (u.score_breakdown ?? []).filter(
            (s) => (s as { ean_confirmed?: boolean }).ean_confirmed,
          ).length;
          await logProductEvent(supabaseAdmin, {
            projectId: data.projectId,
            productId: u.source_product_id,
            kind: "matching_done",
            message: `Dopasowanie: przyjęto ${u.picked_urls.length} źródeł`,
            meta: {
              accepted: u.picked_urls,
              rejected_count: Math.max(0, (u.score_breakdown?.length ?? 0) - u.picked_urls.length),
              ean_confirmed_count: eanConfirmed,
              ai_validation_used: !!apiKey,
            },
          });
        }
      } catch { /* best-effort */ }
    }

    // ---------------------------------------------------------------------
    // Adaptive rescrape trigger. Collect products with fewer than
    // MIN_STRONG_SOURCES strong sources AND rescrape_rounds < MAX_RESCRAPE_ROUNDS,
    // then enqueue a PIM_RESCRAPE bulk job in the background.
    // ---------------------------------------------------------------------
    try {
      const productIdsToRescrape: string[] = [];
      const { data: existingEnrich } = await supabase
        .from("enrichments")
        .select("source_product_id, rescrape_rounds")
        .eq("project_id", data.projectId)
        .in(
          "source_product_id",
          updates.map((u) => u.source_product_id),
        );
      const roundsById = new Map<string, number>();
      for (const r of existingEnrich ?? []) {
        const rr = r as { source_product_id: string; rescrape_rounds: number | null };
        roundsById.set(rr.source_product_id, rr.rescrape_rounds ?? 0);
      }
      for (const u of updates) {
        const strong = (u.score_breakdown ?? []).filter(
          (s) => s.total >= SOURCE_SCORE_THRESHOLD,
        ).length;
        const rounds = roundsById.get(u.source_product_id) ?? 0;
        if (strong < MIN_STRONG_SOURCES && rounds < MAX_RESCRAPE_ROUNDS && u.picked_urls.length < TOP_SOURCES_PER_PRODUCT) {
          productIdsToRescrape.push(u.source_product_id);
        }
      }
      if (productIdsToRescrape.length) {
        const { userId } = context;
        const { error: jobErr } = await supabase
          .from("bulk_jobs" as never)
          .insert({
            project_id: data.projectId,
            user_id: userId,
            kind: "PIM_RESCRAPE",
            items: productIdsToRescrape as never,
            total: productIdsToRescrape.length,
          } as never);
        if (jobErr) {
          console.warn("[runMatching] failed to enqueue PIM_RESCRAPE job:", jobErr.message);
        } else {
          // Fire-and-forget kick to worker (same pattern as bulk-jobs.functions.ts).
          try {
            const base =
              process.env.PUBLIC_APP_URL ||
              "https://project--a56746f2-6fdf-47b1-8095-043a41af98fd.lovable.app";
            const apikeySb = process.env.SUPABASE_PUBLISHABLE_KEY;
            if (apikeySb) {
              void fetch(`${base}/api/public/hooks/process-bulk-jobs`, {
                method: "POST",
                headers: { "Content-Type": "application/json", apikey: apikeySb },
                body: "{}",
              }).catch(() => {});
            }
          } catch {
            /* cron will catch up */
          }
          console.log(`[runMatching] enqueued rescrape for ${productIdsToRescrape.length} products`);
        }
      }
    } catch (e) {
      console.warn("[runMatching] rescrape trigger failed (non-fatal):", e);
    }

    return { matched, total: products.length };
  });

// ---------------------------------------------------------------------------
// Single-product rescorer used by the PIM_RESCRAPE worker. Loads the current
// enrichment.picked_urls (union of matched URLs), fetches product_sources,
// applies AI validation (best-effort) and the same scoring/cap as runMatching,
// then persists new picked_urls + score_breakdown.
// ---------------------------------------------------------------------------
export async function scoreAndCapForProduct(
  projectId: string,
  productId: string,
  apiKey: string | undefined,
  opts?: { force?: boolean },
): Promise<{ count: number; strong: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("settings, strategy")
    .eq("id", projectId)
    .single();
  const rawSettings = ((project as { settings?: unknown } | null)?.settings ?? {}) as Record<string, unknown>;
  const trustedDomains = Array.isArray(rawSettings.trusted_domains)
    ? (rawSettings.trusted_domains as unknown[]).filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0,
      )
    : [];

  const { data: productRow } = await supabaseAdmin
    .from("source_products")
    .select("id, nazwa, ean, raw, manual_lock, matching_mode")
    .eq("id", productId)
    .single();
  if (!productRow) return { count: 0, strong: 0 };
  if ((productRow as { manual_lock?: boolean }).manual_lock && !opts?.force) {
    // Manually locked — do not rescore/overwrite picked_urls.
    return { count: 0, strong: 0 };
  }
  const mode: "strict" | "compatible" =
    ((productRow as { matching_mode?: string | null }).matching_mode === "compatible")
      ? "compatible"
      : "strict";
  const rawObj = ((productRow as { raw?: unknown }).raw ?? {}) as Record<string, unknown>;
  const ie = (rawObj.imported_extract ?? {}) as Record<string, unknown>;
  const producer =
    (typeof ie.producent === "string" && ie.producent.trim()) ||
    (typeof rawObj.producent === "string" && (rawObj.producent as string).trim()) ||
    null;

  // Enrichment currently keeps the "matched" URL list. We need to union it
  // with newly scraped URLs. Newly scraped URLs live in product_sources but
  // may not be in enrichment.picked_urls yet — pull both and rescore all.
  const { data: enRow } = await supabaseAdmin
    .from("enrichments")
    .select("id, picked_urls, matched_term, pinned_main_url, score_breakdown")
    .eq("source_product_id", productId)
    .maybeSingle();
  if (!enRow) return { count: 0, strong: 0 };
  const currentPicked = (enRow.picked_urls as string[] | null) ?? [];
  const pinned = (enRow as { pinned_main_url?: string | null }).pinned_main_url ?? null;
  const prevBd = Array.isArray((enRow as { score_breakdown?: unknown }).score_breakdown)
    ? ((enRow as unknown as { score_breakdown: BreakdownEntry[] }).score_breakdown)
    : [];
  const manualEntries = prevBd.filter((b) => b && (b as { manual?: boolean }).manual === true);
  const manualUrls = manualEntries.map((e) => e.url);

  // Also pull ALL product_sources for the term(s) — union with existing picks.
  const { data: allSrcs } = await supabaseAdmin
    .from("product_sources")
    .select("id, url, title, description, images, extra_images, cleaning_meta")
    .eq("project_id", projectId);
  const bySrcUrl = new Map<string, { title: string | null; description: string | null; imagesCount: number }>();
  const confidenceByUrl = new Map<string, number | null>();
  const descLenByUrl = new Map<string, number>();
  for (const s of allSrcs ?? []) {
    const rr = s as {
      url: string;
      title: string | null;
      description: string | null;
      images: unknown;
      extra_images: unknown;
      cleaning_meta: unknown;
    };
    const main = Array.isArray(rr.images) ? (rr.images as string[]) : [];
    const extra = Array.isArray(rr.extra_images) ? (rr.extra_images as string[]) : [];
    bySrcUrl.set(rr.url, {
      title: rr.title ?? null,
      description: rr.description ?? null,
      imagesCount: main.length + extra.length,
    });
    const cm = (rr.cleaning_meta ?? null) as { confidence?: number | null } | null;
    confidenceByUrl.set(rr.url, cm?.confidence ?? null);
    descLenByUrl.set(rr.url, (rr.description ?? "").length);
  }

  // Candidate URLs = union of previously picked + everything freshly scraped
  // that references this product's search terms is impractical to detect per
  // URL, so we score against currentPicked ∪ any freshly upserted URL that
  // exists in bySrcUrl but not yet in currentPicked AND appeared in the
  // search_results for this product's terms.
  const nazwa = (productRow.nazwa ?? "").trim();
  const terms: string[] = [];
  if (nazwa) terms.push(nazwa.toLowerCase());
  if (productRow.ean) terms.push((productRow.ean ?? "").trim().toLowerCase());
  if (nazwa && productRow.ean) terms.push(`${nazwa} ${productRow.ean}`.toLowerCase());
  const { data: srchRows } = await supabaseAdmin
    .from("search_results")
    .select("term, organic_urls")
    .eq("project_id", projectId);
  const termUrlSet = new Set<string>();
  for (const r of srchRows ?? []) {
    const rr = r as { term: string; organic_urls: unknown };
    if (!terms.includes(rr.term.trim().toLowerCase())) continue;
    if (Array.isArray(rr.organic_urls)) {
      for (const u of rr.organic_urls as unknown[]) if (typeof u === "string") termUrlSet.add(u);
    }
  }
  const candidates = Array.from(new Set([...manualUrls, ...currentPicked, ...Array.from(termUrlSet)]));

  // AI validation (best-effort).
  let kept = candidates;
  let clustersByUrl = new Map<string, string>();
  if (apiKey && nazwa) {
    const sources = candidates
      .map((url) => {
        const m = bySrcUrl.get(url);
        return { url, title: m?.title ?? null, description: m?.description ?? null };
      })
      .filter((s) => s.title || s.description);
    if (sources.length) {
      const val = await validateSourcesWithAI(apiKey, nazwa, productRow.ean ?? null, sources, mode);
      kept = candidates.filter((url) => val.keep.has(url));
      if (!pinned && val.ok) clustersByUrl = val.clustersByUrl;
    }
  }
  // Never drop manual URLs.
  if (manualUrls.length) {
    const set = new Set(kept);
    for (const m of manualUrls) set.add(m);
    kept = Array.from(set);
  }

  const scored = kept.map((url) => {
    const meta = bySrcUrl.get(url) ?? { title: null, description: null, imagesCount: 0 };
    const r = scoreSource(
      meta,
      { nazwa: productRow.nazwa, ean: productRow.ean ?? null, producer },
      url,
      trustedDomains,
    );
    return { url, ...r };
  });
  const positive = scored.filter((x) => x.total > 0);
  const scoreByUrl = new Map(positive.map((x) => [x.url, x.total]));
  const dedup = applyClusterDedup(
    positive.map((x) => x.url),
    scoreByUrl,
    clustersByUrl,
    confidenceByUrl,
    descLenByUrl,
  );
  const rankedFull = positive
    .filter((x) => dedup.keptUrls.has(x.url))
    .sort((a, b) => {
      const ea = a.ean_confirmed ? 1 : 0;
      const eb = b.ean_confirmed ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return b.total - a.total;
    })
    .slice(0, TOP_SOURCES_PER_PRODUCT);
  const ranked = rankedFull.map((x) => x.url);
  const winners: BreakdownEntry[] = rankedFull.map((x) => ({
    url: x.url,
    total: x.total,
    producer_boost: x.producer_boost,
    trusted_boost: x.trusted_boost,
    variant_key: dedup.keyByUrl.get(x.url) ?? null,
    deduped: false,
    ean_confirmed: x.ean_confirmed,
  }));
  const dropped: BreakdownEntry[] = positive
    .filter((x) => dedup.deduped.has(x.url))
    .map((x) => ({
      url: x.url,
      total: x.total,
      producer_boost: x.producer_boost,
      trusted_boost: x.trusted_boost,
      variant_key: dedup.keyByUrl.get(x.url) ?? null,
      deduped: true,
      ean_confirmed: x.ean_confirmed,
    }));
  const breakdown: BreakdownEntry[] = [...winners, ...dropped];

  // Re-inject manual entries so their manual flag survives.
  const bdUrls = new Set(breakdown.map((b) => b.url));
  for (const m of manualEntries) {
    if (!bdUrls.has(m.url)) breakdown.push({ ...m, manual: true });
    else {
      const cur = breakdown.find((b) => b.url === m.url);
      if (cur) (cur as BreakdownEntry).manual = true;
    }
  }
  const rankedSet = new Set(ranked);
  const manualHead = manualUrls.filter((m) => !rankedSet.has(m));
  const finalPicked = manualHead.length ? [...manualHead, ...ranked] : ranked;

  // Auto-suggest compat mode when strict rejected everything on a suspicious name.
  const compatSuggested =
    mode === "strict" && finalPicked.length === 0 && isLikelyCompatProduct(nazwa);

  await supabaseAdmin
    .from("enrichments")
    .update({
      picked_urls: finalPicked as never,
      score_breakdown: breakdown as never,
      status: finalPicked.length ? "MATCHED" : "PENDING",
      compat_suggested: compatSuggested as never,
    } as never)
    .eq("id", enRow.id);

  const strong = breakdown.filter((b) => b.total >= SOURCE_SCORE_THRESHOLD).length;
  if (finalPicked.length > 0) {
    await advancePipelineStatus(supabaseAdmin as never, productId, "MATCHED");
  }
  return { count: finalPicked.length, strong };
}