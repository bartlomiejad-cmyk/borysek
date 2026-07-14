/**
 * Plain (client-safe) module for the "Audyt AI" feature. Contains:
 *
 *  - `auditChecks(input)` — deterministic checks (Phase 1). Returns an array
 *    of `{ check, ok, severity, detail? }`. Never talks to the network.
 *  - `AUDIT_SYSTEM_PROMPT` + `buildAuditUserPrompt` — used by the Phase 2 LLM
 *    call performed by the worker / server function. Kept here so the
 *    single-product server fn and the bulk worker cannot drift apart.
 *  - `combineAuditVerdict(checks, llm)` — folds Phase 1 + Phase 2 into a
 *    single `pass | warn | fail` verdict, matching the spec.
 *
 * Audit never modifies golden data, images, sources, or pipeline_status —
 * only enrichments.audit and source_products.review_status.
 */

// Kept in sync with SOURCE_SCORE_THRESHOLD in ./matching.functions.
// Duplicated deliberately so this module stays client-safe (matching.functions
// transitively pulls llm-cleaner.server, which is blocked from client bundles).
const SOURCE_SCORE_THRESHOLD = 4;

export type AuditSeverity = "fail" | "warn";
export type AuditCheckKey =
  | "golden_complete"
  | "desc_length"
  | "ean_valid"
  | "sources_ok"
  | "main_image_ok"
  | "viz_qc_ok"
  | "data_sufficiency_ok";

export type AuditCheck = {
  check: AuditCheckKey;
  ok: boolean;
  severity: AuditSeverity;
  detail?: string;
};

export type AuditVerdict = "pass" | "warn" | "fail";

export type AuditLlmResult = {
  factual_issues: string[];
  guideline_violations: string[];
  style_issues: string[];
  verdict: AuditVerdict;
};

export type AuditResult = {
  at: string; // ISO
  checks: AuditCheck[];
  llm: AuditLlmResult | null;
  verdict: AuditVerdict;
};

export type AuditInput = {
  golden_name?: string | null;
  golden_slug?: string | null;
  golden_meta_description?: string | null;
  golden_description?: string | null;
  golden_features?: Array<{ key: string; value: string }> | null;
  data_sufficiency?: "full" | "partial" | "poor" | null;
  ean?: string | null;
  score_breakdown?: Array<{ url: string; total: number; ean_confirmed?: boolean }> | null;
  pinned_main_url?: string | null;
  regenerated_main_image?: string | null;
  image_scores?: Record<
    string,
    { is_banner_or_trash?: boolean; identity?: string | null }
  > | null;
  quality?: {
    watermark_urls?: string[];
    name_mismatch?: boolean;
  } | null;
  /**
   * Post-generation Vision QC result for the regenerated thumbnail
   * (persisted on `enrichments.image_meta.thumbnail_qc`). When present,
   * failing checks demote `main_image_ok` to a warning.
   */
  thumbnail_qc?: {
    bg_white?: boolean;
    product_intact?: boolean;
    framing_ok?: boolean;
    issues?: string[];
    candidate_url?: string | null;
  } | null;
  /**
   * Post-generation Vision QC results for lifestyle visualisations
   * (persisted on `enrichments.image_meta.viz_qc` as a URL-keyed map). Any
   * entry with `passed:false` demotes the audit to a warning.
   */
  viz_qc?: Record<
    string,
    { passed?: boolean; product_intact?: boolean; product_visible?: boolean; issues?: string[] }
  > | null;
};

// --- Helpers ---------------------------------------------------------------

/** Strip HTML tags for visible-length measurements. */
export function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** GS1 check-digit for GTIN-8/12/13/14. */
function isValidGtin(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(d.length)) return false;
  const digits = d.split("").map((c) => Number.parseInt(c, 10));
  const check = digits.pop()!;
  // Weighting alternates 3/1 from the rightmost data digit.
  const sum = digits
    .reverse()
    .reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}

// --- Phase 1: deterministic checks ----------------------------------------

export function auditChecks(input: AuditInput): AuditCheck[] {
  const checks: AuditCheck[] = [];

  // a) golden_complete
  const name = (input.golden_name ?? "").trim();
  const slug = (input.golden_slug ?? "").trim();
  const meta = (input.golden_meta_description ?? "").trim();
  const desc = (input.golden_description ?? "").trim();
  const features = Array.isArray(input.golden_features) ? input.golden_features : [];
  const missing: string[] = [];
  if (!name) missing.push("nazwa");
  if (!slug) missing.push("slug");
  if (!meta) missing.push("meta-description");
  if (!desc) missing.push("opis");
  if (features.length < 3) missing.push(`cechy (${features.length}/3)`);
  const goldenComplete = missing.length === 0;
  checks.push({
    check: "golden_complete",
    ok: goldenComplete,
    severity: "fail",
    detail: goldenComplete ? undefined : `brakuje: ${missing.join(", ")}`,
  });

  // b) desc_length (warn)
  const visibleLen = visibleText(desc).length;
  const minLen = input.data_sufficiency === "poor" ? 120 : 300;
  checks.push({
    check: "desc_length",
    ok: visibleLen >= minLen,
    severity: "warn",
    detail:
      visibleLen >= minLen
        ? undefined
        : `opis ${visibleLen} znaków (minimum ${minLen})`,
  });

  // c) ean_valid — skip when empty
  const eanRaw = (input.ean ?? "").trim();
  if (eanRaw) {
    const valid = isValidGtin(eanRaw);
    checks.push({
      check: "ean_valid",
      ok: valid,
      severity: "fail",
      detail: valid ? undefined : `EAN „${eanRaw}" nie ma poprawnej sumy kontrolnej GTIN`,
    });
  }

  // d) sources_ok (warn) — >= 2 entries with total >= SOURCE_SCORE_THRESHOLD.
  const strong = (input.score_breakdown ?? []).filter(
    (b) => (b?.total ?? 0) >= SOURCE_SCORE_THRESHOLD,
  );
  checks.push({
    check: "sources_ok",
    ok: strong.length >= 2,
    severity: "warn",
    detail:
      strong.length >= 2
        ? undefined
        : `tylko ${strong.length} silnych źródeł (potrzebne 2+)`,
  });

  // e) main_image_ok (warn, but fails on watermark / name_mismatch)
  const mainUrl = (input.pinned_main_url ?? input.regenerated_main_image ?? "").trim();
  const watermarks = new Set(input.quality?.watermark_urls ?? []);
  const nameMismatch = !!input.quality?.name_mismatch;
  if (!mainUrl) {
    checks.push({
      check: "main_image_ok",
      ok: false,
      severity: "warn",
      detail: "brak głównego zdjęcia (przypnij lub zregeneruj)",
    });
  } else if (watermarks.has(mainUrl) || nameMismatch) {
    checks.push({
      check: "main_image_ok",
      ok: false,
      severity: "fail",
      detail: watermarks.has(mainUrl)
        ? "główne zdjęcie ma znak wodny"
        : "nazwa produktu na zdjęciu nie zgadza się ze złotym rekordem",
    });
  } else {
    const s = input.image_scores?.[mainUrl];
    const isTrash = !!s?.is_banner_or_trash;
    const isDifferent = (s?.identity ?? "") === "different";
    // Extra warning: post-generation Vision QC of the regenerated thumbnail.
    const qc = input.thumbnail_qc ?? null;
    const qcFailures: string[] = [];
    if (qc) {
      if (qc.bg_white === false) qcFailures.push("tło nie jest białe");
      if (qc.product_intact === false) qcFailures.push("produkt zmieniony vs. referencja");
      if (qc.framing_ok === false) qcFailures.push("kadrowanie poza normą");
    }
    const baseIssues = [
      isTrash ? "główne zdjęcie oznaczone jako banner/śmieć" : "",
      isDifferent ? "AI ocenia, że to inny produkt" : "",
    ].filter(Boolean);
    const allIssues = [...baseIssues, ...(qcFailures.length ? [`QC miniatury: ${qcFailures.join(", ")}`] : [])];
    checks.push({
      check: "main_image_ok",
      ok: !isTrash && !isDifferent && qcFailures.length === 0,
      severity: "warn",
      detail: allIssues.length ? allIssues.join("; ") : undefined,
    });
  }

  // f) data_sufficiency_ok
  const ds = input.data_sufficiency ?? "full";
  if (ds === "full") {
    checks.push({ check: "data_sufficiency_ok", ok: true, severity: "warn" });
  } else if (ds === "partial") {
    checks.push({
      check: "data_sufficiency_ok",
      ok: false,
      severity: "warn",
      detail: "częściowe dane — braki w źródłach",
    });
  } else {
    checks.push({
      check: "data_sufficiency_ok",
      ok: false,
      severity: "fail",
      detail: "słabe dane źródłowe — opis może być niepełny",
    });
  }

  return checks;
}

// --- Phase 2: LLM cross-check ---------------------------------------------

export const AUDIT_SYSTEM_PROMPT = [
  "Jesteś audytorem jakości katalogu produktów. Porównaj ZŁOTY REKORD ze ŹRÓDŁAMI i WYTYCZNYMI KLIENTA.",
  'Zwróć JSON: {"factual_issues": string[], "guideline_violations": string[], "style_issues": string[], "verdict": "pass"|"warn"|"fail"}.',
  "factual_issues: twierdzenia bez pokrycia w źródłach lub sprzeczne z nimi.",
  "guideline_violations: konkretne naruszenia wytycznych (pusta lista gdy brak wytycznych).",
  "style_issues: ogólniki marketingowe, powtórzenia, błędy językowe — NIGDY nie obniżają werdyktu poniżej warn.",
  "verdict fail wyłącznie przy błędach faktycznych lub złamaniu wytycznych.",
  "Każdy problem jednym zwięzłym zdaniem po polsku.",
].join("\n");

export function buildAuditUserPrompt(args: {
  goldenName: string;
  goldenDescriptionVisible: string;
  features: Array<{ key: string; value: string }>;
  topSources: Array<{ url?: string; description?: string | null; title?: string | null }>;
  clientGuidelines: string;
}): string {
  const parts: string[] = [];
  parts.push(`NAZWA: ${args.goldenName}`);
  parts.push("");
  parts.push("OPIS ZŁOTEGO REKORDU (tekst widoczny):");
  parts.push(args.goldenDescriptionVisible.slice(0, 3000) || "(brak)");
  parts.push("");
  parts.push("CECHY / PARAMETRY:");
  parts.push(
    args.features.length
      ? args.features.map((f) => `- ${f.key}: ${f.value}`).join("\n")
      : "(brak)",
  );
  parts.push("");
  parts.push("ŹRÓDŁA (do porównania faktów):");
  const top = args.topSources.slice(0, 2);
  if (!top.length) parts.push("(brak)");
  else {
    for (const [i, s] of top.entries()) {
      const title = (s.title ?? "").trim();
      const desc = ((s.description ?? "") as string).slice(0, 1500);
      parts.push(`#${i + 1} ${title ? `[${title}] ` : ""}${s.url ?? ""}`);
      parts.push(desc || "(brak opisu)");
      parts.push("");
    }
  }
  parts.push("WYTYCZNE KLIENTA:");
  const g = (args.clientGuidelines ?? "").slice(0, 2000).trim();
  parts.push(g || "(brak wytycznych — pomiń guideline_violations)");
  return parts.join("\n");
}

/**
 * Combine deterministic checks + LLM verdict into overall verdict.
 *
 * - any failed check with severity=fail    → fail
 * - LLM verdict fail                       → fail
 * - any failed check with severity=warn    → warn
 * - LLM verdict warn                       → warn
 * - otherwise                              → pass
 */
export function combineAuditVerdict(
  checks: AuditCheck[],
  llm: AuditLlmResult | null,
): AuditVerdict {
  const hasFail = checks.some((c) => !c.ok && c.severity === "fail");
  if (hasFail) return "fail";
  if (llm?.verdict === "fail") return "fail";
  const hasWarn = checks.some((c) => !c.ok && c.severity === "warn");
  if (hasWarn) return "warn";
  if (llm?.verdict === "warn") return "warn";
  return "pass";
}

/** Map verdict → source_products.review_status transition. Never touches APPROVED. */
export function verdictToReviewStatus(
  current: string | null | undefined,
  verdict: AuditVerdict,
): string | null {
  if ((current ?? "") === "APPROVED") return null; // never overwrite manual approval
  if (verdict === "fail") return "AI_FLAGGED";
  if (verdict === "warn") return "NEEDS_REVIEW";
  return null; // pass — leave unchanged
}

export const AUDIT_CHECK_LABELS: Record<AuditCheckKey, string> = {
  golden_complete: "Kompletny złoty rekord",
  desc_length: "Długość opisu",
  ean_valid: "Poprawność EAN",
  sources_ok: "Silne źródła",
  main_image_ok: "Główne zdjęcie",
  data_sufficiency_ok: "Wystarczalność danych",
};

export const AUDIT_VERDICT_META: Record<
  AuditVerdict,
  { label: string; badge: string }
> = {
  pass: {
    label: "Audyt: OK",
    badge:
      "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  warn: {
    label: "Audyt: ostrzeżenie",
    badge:
      "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  fail: {
    label: "Audyt: błąd",
    badge: "border-destructive/60 bg-destructive/10 text-destructive",
  },
};