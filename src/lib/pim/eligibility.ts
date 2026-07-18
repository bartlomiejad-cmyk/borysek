// Shared predicate: which source_products are eligible to enter a pipeline
// action (discovery, matching, regen, image verify, visualizations, bulk
// UI actions). Excluded reasons — auto_no_sources / manual / variant — and
// variant rows must never consume paid pipeline budget.
//
// Columns are NOT NULL with defaults (excluded=false, row_kind='main'), so
// `.eq("excluded", false).neq("row_kind", "variant")` is safe on the server
// side. On the client side we still check for null defensively.

export type EligibleLike = {
  excluded?: boolean | null;
  row_kind?: string | null;
};

/** Client-side predicate — use in .filter() calls over already-loaded rows. */
export function isPipelineEligible(p: EligibleLike): boolean {
  if (p.excluded === true) return false;
  if ((p.row_kind ?? "main") === "variant") return false;
  return true;
}

/**
 * Apply the eligibility filter to a Supabase query builder. Chains
 * `.eq("excluded", false).neq("row_kind", "variant")` and returns the
 * builder so it stays chainable. Untyped generic passthrough because
 * PostgREST builder generics change on each chained call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEligibilityFilter<Q>(q: Q): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = q as any;
  return b.eq("excluded", false).neq("row_kind", "variant") as Q;
}
