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