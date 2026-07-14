/**
 * LLM-first product description cleaner.
 *
 * Primary path: pre-filter with the regex sanitizer (to reduce token count),
 * then ask a small Gemini model to keep only content that describes this
 * exact product and return whitelist-safe HTML.
 *
 * Fallback: on any failure (missing key, gateway error, invalid JSON,
 * validation fail) we return the regex output tagged as `cleaned_by: "regex"`.
 */

import { sanitizeProductDescription } from "./source-cleanup";

const CLEANER_MODEL = "google/gemini-2.5-flash-lite";
const MAX_INPUT_CHARS = 12000;
const MIN_OUTPUT_CHARS = 100;
const MAX_OUTPUT_CHARS = 8000;
const ALLOWED_TAGS = new Set(["h3", "p", "ul", "li", "strong", "table", "tr", "td"]);
const FORBIDDEN_TAGS_RE = /<\s*\/?\s*(script|style|iframe)\b/i;

export type CleaningMeta = {
  cleaned_by: "llm" | "regex";
  confidence: number | null;
  removed_sections: string[];
  /**
   * When the LLM explicitly says the scraped HTML does NOT describe this
   * product (different category / article), we keep the regex output as
   * `description` but tag the source so downstream code can apply the
   * junk penalty and skip AI validation.
   */
  page_matches_product?: boolean;
};

export type LlmCleanResult = {
  description: string;
  features: Array<{ key: string; value: string }>;
  meta: CleaningMeta;
};

function whitelistSanitize(html: string): string {
  // Strip any tag not in ALLOWED_TAGS. Keep inner text.
  return html.replace(/<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (match, tag: string) => {
    return ALLOWED_TAGS.has(tag.toLowerCase()) ? match : "";
  });
}

function regexFallback(rawHtml: string, reason: string): LlmCleanResult {
  if (reason) console.warn(`[llm-cleaner] fallback → regex: ${reason}`);
  const description = sanitizeProductDescription(rawHtml);
  return {
    description,
    features: [],
    meta: { cleaned_by: "regex", confidence: null, removed_sections: [] },
  };
}

/**
 * Tokens from the product name that are "distinctive enough" to serve as
 * a fingerprint — used by the hallucination guard. Skips short tokens and
 * common Polish stop-words.
 */
const NAME_STOPWORDS = new Set([
  "do", "dla", "the", "and", "oraz", "lub", "na", "od", "ze", "za", "pro", "plus",
]);
function distinctiveTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .split(/[\s,\-_/()]+/)
    .map((t) => t.replace(/[.:;]+$/g, "").trim())
    .filter((t) => t.length >= 4 && !NAME_STOPWORDS.has(t));
}

function isHallucinated(
  cleanedHtml: string,
  preClean: string,
  productName: string | null | undefined,
): boolean {
  const tokens = distinctiveTokens(productName);
  if (!tokens.length) return false;
  const outLC = cleanedHtml.toLowerCase();
  const inLC = preClean.toLowerCase();
  // Output "talks about" the product (mentions name tokens) but the input
  // text mentions none of them — the model must have invented content.
  const outMentions = tokens.some((t) => outLC.includes(t));
  const inMentions = tokens.some((t) => inLC.includes(t));
  return outMentions && !inMentions;
}

function pageMismatchResult(rawHtml: string): LlmCleanResult {
  const description = sanitizeProductDescription(rawHtml);
  return {
    description,
    features: [],
    meta: {
      cleaned_by: "llm",
      confidence: 0,
      removed_sections: [],
      page_matches_product: false,
    },
  };
}

export async function llmCleanDescription(opts: {
  rawHtml: string;
  productName: string | null;
  brand?: string | null;
  ean?: string | null;
}): Promise<LlmCleanResult> {
  const apiKey = process.env.LOVABLE_API_KEY;

  // Always pre-filter with the regex sanitizer — this is the token-reducing
  // safety net AND the fallback if the LLM path fails.
  const preClean = sanitizeProductDescription(opts.rawHtml);
  if (!apiKey) return regexFallback(opts.rawHtml, "LOVABLE_API_KEY missing");
  if (!preClean || preClean.length < 40) {
    return {
      description: preClean,
      features: [],
      meta: { cleaned_by: "regex", confidence: null, removed_sections: [] },
    };
  }

  const trimmed = preClean.slice(0, MAX_INPUT_CHARS);

  const system = [
    "You receive HTML scraped from an e-commerce product page.",
    `Return ONLY content that describes this exact product: ${opts.productName ?? "(unknown)"}, brand: ${opts.brand ?? "(unknown)"}, EAN: ${opts.ean ?? "(unknown)"}.`,
    "Remove: shipping/delivery info, return policies, prices, promotions, contact data, phone numbers, related/recommended products, reviews, store navigation, cookie notices.",
    "Preserve the HTML structure of the remaining content using only these tags: h3, p, ul, li, strong, table, tr, td.",
    "OUTPUT LANGUAGE: description_html MUST be in Polish. If the source is in another language, translate to natural Polish while preserving literally: product name, brand, model, variant, units, calibers, weights and technical designations. Do not add commercial information absent from the source.",
    "Features keys must also be in Polish (np. \"Waga\", \"Kaliber\", \"Materiał\").",
    "Jeżeli dostarczony HTML NIE opisuje tego produktu (inna kategoria, inny artykuł), zwróć page_matches_product=false, description_html=\"\" i confidence=0.",
    "description_html może zawierać WYŁĄCZNIE treść obecną w dostarczonym HTML — nigdy nie uzupełniaj braków wiedzą o produkcie z nagłówka/kontekstu.",
    'Output JSON: { "page_matches_product": boolean, "description_html": string, "features": [{"key": string, "value": string}], "confidence": number 0-1, "removed_sections": string[] }.',
  ].join("\n");

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: CLEANER_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: trimmed },
        ],
      }),
    });
    if (!res.ok) return regexFallback(opts.rawHtml, `gateway ${res.status}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: {
      page_matches_product?: unknown;
      description_html?: unknown;
      features?: unknown;
      confidence?: unknown;
      removed_sections?: unknown;
    };
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return regexFallback(opts.rawHtml, `invalid JSON: ${e instanceof Error ? e.message : e}`);
    }
    // Explicit "this page is not about that product" signal.
    if (parsed.page_matches_product === false) {
      console.warn(`[llm-cleaner] page_matches_product=false for "${opts.productName ?? ""}"`);
      return pageMismatchResult(opts.rawHtml);
    }
    const rawOut = typeof parsed.description_html === "string" ? parsed.description_html : "";
    if (!rawOut) return regexFallback(opts.rawHtml, "empty description_html");
    if (FORBIDDEN_TAGS_RE.test(rawOut)) {
      return regexFallback(opts.rawHtml, "output contained script/style/iframe");
    }
    const cleaned = whitelistSanitize(rawOut).replace(/\s{2,}/g, " ").trim();
    if (cleaned.length < MIN_OUTPUT_CHARS || cleaned.length > MAX_OUTPUT_CHARS) {
      return regexFallback(opts.rawHtml, `length out of bounds (${cleaned.length})`);
    }
    // Post-validation hallucination guard: the cleaned output mentions the
    // product name but the input pre-clean text does not — the model
    // fabricated the description. Treat exactly like page_matches_product=false.
    if (isHallucinated(cleaned, preClean, opts.productName)) {
      console.warn(
        `[llm-cleaner] hallucination-guard triggered for "${opts.productName ?? ""}" — output mentions product tokens absent from input`,
      );
      return pageMismatchResult(opts.rawHtml);
    }
    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : null;
    const removed = Array.isArray(parsed.removed_sections)
      ? parsed.removed_sections
          .filter((s): s is string => typeof s === "string")
          .slice(0, 20)
      : [];
    const features: Array<{ key: string; value: string }> = Array.isArray(parsed.features)
      ? (parsed.features as unknown[])
          .map((f) => {
            if (typeof f === "string") {
              const s = f.trim();
              return s ? { key: "Cecha", value: s } : null;
            }
            if (f && typeof f === "object") {
              const ff = f as { key?: unknown; value?: unknown };
              const key = typeof ff.key === "string" ? ff.key.trim() : "";
              const value = typeof ff.value === "string" ? ff.value.trim() : "";
              if (key && value) return { key, value };
            }
            return null;
          })
          .filter((x): x is { key: string; value: string } => x !== null)
          .slice(0, 20)
      : [];
    return {
      description: cleaned,
      features,
      meta: {
        cleaned_by: "llm",
        confidence,
        removed_sections: removed,
        page_matches_product: true,
      },
    };
  } catch (e) {
    return regexFallback(opts.rawHtml, e instanceof Error ? e.message : String(e));
  }
}