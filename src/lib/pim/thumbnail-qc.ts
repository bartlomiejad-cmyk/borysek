/**
 * Post-generation Vision QC for regenerated product thumbnails.
 *
 * After we run seedream + Bria background-removal, we still occasionally get:
 *  - a subtly gray/beige background instead of pure #FFFFFF,
 *  - a logo/text/color drift on the product itself,
 *  - a mis-framed shot (too small, off-center, cropped).
 *
 * This module asks Gemini Vision to compare the SOURCE reference (input to FAL)
 * with the GENERATED candidate and returns three boolean checks + issues list.
 * The runner uses the result to (a) retry with a corrective prompt suffix and
 * (b) persist a `thumbnail_qc` block on `enrichments.image_meta`.
 *
 * Client-safe: no server-only imports (no supabaseAdmin, no fs, etc.), so the
 * audit UI can share the types.
 */

export type ThumbnailQcResult = {
  bg_white: boolean;
  product_intact: boolean;
  framing_ok: boolean;
  issues: string[];
};

export type ThumbnailQcPersisted = ThumbnailQcResult & {
  attempts: number;
  at: string; // ISO
  candidate_url?: string | null;
};

export const THUMBNAIL_QC_SYSTEM_PROMPT = [
  "Jesteś kontrolerem jakości miniatur e-commerce.",
  "Otrzymasz DWA obrazy: (1) referencję źródłową i (2) wygenerowaną miniaturę.",
  "Sprawdź TYLKO obraz 2 vs. obraz 1 i zwróć JSON:",
  "{",
  '  "bg_white": boolean,       // tło jednolicie białe #FFFFFF, bez szarości/gradientu/winiety/beżu',
  '  "product_intact": boolean, // kolor, logo, napisy i proporcje produktu zgodne z referencją',
  '  "framing_ok": boolean,     // produkt wypełnia ~60-85% kadru, wycentrowany, nieucięty',
  '  "issues": string[]         // konkretne problemy po polsku; puste gdy wszystko OK',
  "}",
  "Bądź surowy: przy wątpliwościach ustaw check na false i dopisz powód do issues.",
].join("\n");

/**
 * Build a corrective sentence appended to the FAL prompt on the next attempt.
 * Only targets the checks that failed, so the retry pushes hardest on the
 * actual defect instead of blindly repeating the base prompt.
 */
export function buildCorrectionSentence(qc: ThumbnailQcResult): string {
  const parts: string[] = [];
  if (!qc.bg_white) {
    parts.push(
      "PREVIOUS ATTEMPT HAD A NON-WHITE BACKGROUND. The background MUST be mathematically flat #FFFFFF, RGB(255,255,255), luminance L=100 — no gray, no beige, no gradient, no vignette, no soft-box falloff, identical white pixel value in all four corners and along every edge.",
    );
  }
  if (!qc.product_intact) {
    parts.push(
      "PREVIOUS ATTEMPT ALTERED THE PRODUCT. Preserve the product from the source image PIXEL-FAITHFULLY: same colour, same printed labels/logos/brand text, same proportions and materials. DO NOT redraw, restyle, recolour, whiten, desaturate or invent packaging graphics.",
    );
  }
  if (!qc.framing_ok) {
    parts.push(
      "PREVIOUS ATTEMPT WAS MIS-FRAMED. Scale the product so its longest edge spans ~75% of the canvas, centered horizontally AND vertically with equal ~12-15% margins on all four sides. Do NOT leave large empty white space, do NOT crop or push the product to any edge.",
    );
  }
  return parts.join(" ");
}

/** Number of QC checks that passed. */
export function qcScore(qc: ThumbnailQcResult): number {
  return (qc.bg_white ? 1 : 0) + (qc.product_intact ? 1 : 0) + (qc.framing_ok ? 1 : 0);
}

export function qcAllPass(qc: ThumbnailQcResult): boolean {
  return qc.bg_white && qc.product_intact && qc.framing_ok;
}

// ---------------------------------------------------------------------------
// Visualization QC (lifestyle / in-scene renders) — same pattern as the
// thumbnail QC above, but we do NOT check background (scenes have props and
// coloured backgrounds by design). Instead we check that the product itself
// looks identical to the reference and is clearly visible / not obscured.
// ---------------------------------------------------------------------------

export type VisualizationQcResult = {
  product_intact: boolean;
  product_visible: boolean;
  /**
   * True when the rendered product carries printed text/codes/branding that
   * is NOT visible on the primary reference (image 1). Triggered by the QC
   * prompt below; retried once with a corrective sentence, then review-flagged.
   */
  fabricated_text: boolean;
  issues: string[];
};

export type VisualizationQcPersisted = VisualizationQcResult & {
  passed: boolean;
  attempts: number;
  at: string; // ISO
  reference_url?: string | null;
};

export const VISUALIZATION_QC_SYSTEM_PROMPT = [
  "Jesteś kontrolerem jakości wizualizacji lifestyle e-commerce.",
  "Otrzymasz DWA obrazy: (1) referencję produktu i (2) wygenerowaną wizualizację ze sceną.",
  "Sprawdź TYLKO produkt na obrazie 2 vs. produkt na obrazie 1 (tło i rekwizyty pomijamy) i zwróć JSON:",
  "{",
  '  "product_intact": boolean,   // kolor CAŁEJ powierzchni (w tym rdzeń/wnętrze), materiał i proporcje zgodne z referencją; logo/napisy zachowane',
  '  "product_visible": boolean,  // produkt jest głównym obiektem, nieucięty, nie zasłonięty rekwizytami',
  '  "fabricated_text": boolean,  // TRUE gdy na produkcie na obrazie 2 widnieje tekst/kod/marka/logo nieobecne na obrazie 1 (referencji). FALSE gdy wszystkie napisy są wiernie odwzorowane z referencji lub gdy produkt w obu obrazach jest bez napisów.',
  '  "issues": string[]           // konkretne różnice po polsku (np. "rdzeń rolki na obrazie 2 jest czarny, w referencji jest jasny"); puste gdy wszystko OK',
  "}",
  "Bądź surowy: przy JAKIEJKOLWIEK niezgodności koloru produktu, rdzenia, wnętrza, logo czy proporcji — product_intact=false i wypisz konkretne różnice.",
  "Zasada tekstu: NIE wolno dodać żadnego napisu/kodu/marki, którego nie ma na referencji nr 1. Jeżeli referencja jest bez tekstu, produkt musi być bez tekstu.",
].join("\n");

export function visualizationQcScore(qc: VisualizationQcResult): number {
  return (qc.product_intact ? 2 : 0) + (qc.product_visible ? 1 : 0) + (qc.fabricated_text ? 0 : 1);
}

export function visualizationQcPassed(qc: VisualizationQcResult): boolean {
  return qc.product_intact && qc.product_visible && !qc.fabricated_text;
}

/**
 * Corrective sentence appended to the FAL prompt on the next visualisation
 * attempt. Injects the CONCRETE issues Gemini reported so the retry pushes on
 * the actual defect (e.g. "the roll's core is black — must be light/white").
 */
export function buildVisualizationCorrectionSentence(qc: VisualizationQcResult): string {
  const parts: string[] = [];
  if (!qc.product_intact) {
    const issueList = qc.issues.slice(0, 4).map((s) => `- ${s}`).join("\n");
    parts.push(
      [
        "PREVIOUS ATTEMPT ALTERED THE PRODUCT ITSELF.",
        "Reference image #1 is the ONLY source of truth for the product's colour(s), core/inside colour, printed labels, logos, materials and proportions.",
        "Match the product to reference image #1 PIXEL-FAITHFULLY. Do not recolour, invent packaging graphics, darken cores/interiors, or paint over labels.",
        issueList ? `Concrete mismatches to fix on this retry:\n${issueList}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  if (!qc.product_visible) {
    parts.push(
      "PREVIOUS ATTEMPT HID THE PRODUCT. The product must be the hero of the shot: fully visible, sharp, unobstructed by props, not cropped, occupying a clear central region of the frame.",
    );
  }
  if (qc.fabricated_text) {
    parts.push(
      "PREVIOUS ATTEMPT PRINTED FABRICATED TEXT/BRANDING on the product. Reference image #1 is the ONLY source of truth for printed text, codes, labels and logos on the product surface. Reproduce ONLY what is physically visible on reference image #1. If reference #1 has no printed text on the product, the product surface MUST remain textless — do not add codes, brand names or model numbers copied from other reference images.",
    );
  }
  return parts.join(" ");
}

export async function runVisualizationQc(
  apiKey: string,
  referenceUrl: string,
  candidateUrl: string,
): Promise<VisualizationQcResult> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: VISUALIZATION_QC_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Porównaj produkt na wizualizacji (obraz 2) z referencją (obraz 1). " +
                "Tło i rekwizyty pomijamy. Zwróć JSON zgodny ze schematem z system prompta.",
            },
            { type: "image_url", image_url: { url: referenceUrl } },
            { type: "image_url", image_url: { url: candidateUrl } },
          ],
        },
      ],
    }),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini viz QC ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Gemini viz QC: nie zwrócił JSON-a");
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const asBool = (v: unknown, fallback: boolean): boolean =>
    typeof v === "boolean" ? v : fallback;
  const rawIssues = Array.isArray((obj as { issues?: unknown }).issues)
    ? ((obj as { issues: unknown[] }).issues)
    : [];
  const issues = rawIssues
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 10);
  return {
    product_intact: asBool(obj.product_intact, true),
    product_visible: asBool(obj.product_visible, true),
    fabricated_text: asBool(obj.fabricated_text, false),
    issues,
  };
}

// ---------------------------------------------------------------------------
// Reference consistency check — before generation, decide which of the
// candidate reference images actually show the SAME product (colour, core,
// proportions). Runs at most once per product per batch; caller caches the
// result. Returns 0-based indices of images considered consistent with the
// FIRST image; the first image is always included.
// ---------------------------------------------------------------------------

export const REFERENCE_CONSISTENCY_SYSTEM_PROMPT = [
  "Jesteś kontrolerem spójności zdjęć produktu.",
  "Otrzymasz N zdjęć (indeksowanych od 0) rzekomo TEGO SAMEGO produktu.",
  "Traktuj obraz 0 jako referencję — pozostałe zdjęcia SĄ spójne tylko, jeśli pokazują produkt o identycznym wyglądzie (ten sam kolor, rdzeń/wnętrze, proporcje, kształt, etykiety).",
  'Zwróć JSON: {"consistent_indices": number[]}. Obraz 0 zawsze na liście, jeśli w ogóle wygląda jak produkt. Odrzuć zdjęcia innych wariantów kolorystycznych, innych rozmiarów, innych produktów tej samej marki.',
  "Bądź surowy — w razie wątpliwości NIE dołączaj obrazu.",
].join("\n");

export async function runReferenceConsistencyCheck(
  apiKey: string,
  urls: string[],
): Promise<number[]> {
  const capped = urls.slice(0, 6);
  if (capped.length <= 1) return capped.map((_, i) => i);
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text:
        `Sprawdź ${capped.length} zdjęć poniżej (indeksy 0..${capped.length - 1}). ` +
        `Obraz 0 to referencja. Zwróć JSON {"consistent_indices": number[]}.`,
    },
  ];
  for (const u of capped) content.push({ type: "image_url", image_url: { url: u } });
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: REFERENCE_CONSISTENCY_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) {
    // Fail-safe: on gateway error use only the first reference so we never
    // pass an inconsistent mix to FAL.
    return [0];
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [0];
  }
  const arr = (parsed as { consistent_indices?: unknown })?.consistent_indices;
  if (!Array.isArray(arr)) return [0];
  const idx = arr
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .map((n) => Math.trunc(n))
    .filter((n) => n >= 0 && n < capped.length);
  const set = new Set<number>(idx);
  set.add(0); // reference always included
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Call Gemini Vision through Lovable AI Gateway to score a candidate thumbnail
 * against its source reference. Throws on gateway failure; callers decide
 * whether to skip QC or fail the attempt.
 */
export async function runThumbnailQc(
  apiKey: string,
  referenceUrl: string,
  candidateUrl: string,
): Promise<ThumbnailQcResult> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: THUMBNAIL_QC_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Porównaj wygenerowaną miniaturę (obraz 2) z referencją (obraz 1). " +
                "Zwróć JSON zgodny ze schematem z system prompta.",
            },
            { type: "image_url", image_url: { url: referenceUrl } },
            { type: "image_url", image_url: { url: candidateUrl } },
          ],
        },
      ],
    }),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini QC ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Gemini QC: nie zwrócił JSON-a");
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const asBool = (v: unknown, fallback: boolean): boolean =>
    typeof v === "boolean" ? v : fallback;
  const rawIssues = Array.isArray((obj as { issues?: unknown }).issues)
    ? ((obj as { issues: unknown[] }).issues)
    : [];
  const issues = rawIssues
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 10);
  return {
    bg_white: asBool(obj.bg_white, true),
    product_intact: asBool(obj.product_intact, true),
    framing_ok: asBool(obj.framing_ok, true),
    issues,
  };
}