// Per-product pipeline state machine. Kept as a plain module so it can be
// imported from server functions AND worker code without creating a
// serverFn sibling-scope hazard.

export type PimPipelineStatus =
  | "IMPORTED"
  | "SOURCES_FOUND"
  | "MATCHED"
  | "GOLDEN_READY"
  | "VISUALS_READY";

const RANK: Record<PimPipelineStatus, number> = {
  IMPORTED: 0,
  SOURCES_FOUND: 1,
  MATCHED: 2,
  GOLDEN_READY: 3,
  VISUALS_READY: 4,
};

export const PIPELINE_STATUS_LABEL: Record<PimPipelineStatus, string> = {
  IMPORTED: "Zaimportowany",
  SOURCES_FOUND: "Źródła znalezione",
  MATCHED: "Dopasowany",
  GOLDEN_READY: "Rekord gotowy",
  VISUALS_READY: "Media gotowe",
};

export function pipelineStatusRank(s: PimPipelineStatus | string | null | undefined): number {
  if (!s) return 0;
  return RANK[s as PimPipelineStatus] ?? 0;
}

// Minimal Supabase-like client shape (avoid pulling generated types across
// server/worker modules).
type SupaLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: unknown }>;
    };
  };
};

/**
 * Forward-only advance. Bumps source_products.pipeline_status to `target`
 * only when `target` has a higher rank than the current value. Never
 * downgrades. Silently no-ops on read errors so worker success paths are
 * not turned into failures by a bookkeeping row miss.
 */
export async function advancePipelineStatus(
  supabase: SupaLike,
  productId: string,
  target: PimPipelineStatus,
): Promise<void> {
  try {
    const { data } = await supabase
      .from("source_products")
      .select("pipeline_status")
      .eq("id", productId)
      .maybeSingle();
    const cur = ((data as { pipeline_status?: string } | null)?.pipeline_status ?? "IMPORTED") as PimPipelineStatus;
    if (RANK[target] > (RANK[cur] ?? 0)) {
      await supabase
        .from("source_products")
        .update({ pipeline_status: target })
        .eq("id", productId);
    }
  } catch {
    /* non-fatal */
  }
}

export async function isProductLocked(
  supabase: SupaLike,
  productId: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("source_products")
      .select("manual_lock")
      .eq("id", productId)
      .maybeSingle();
    return !!(data as { manual_lock?: boolean } | null)?.manual_lock;
  } catch {
    return false;
  }
}

export async function setManualLockOnProduct(
  supabase: SupaLike,
  productId: string,
  locked: boolean,
): Promise<void> {
  try {
    await supabase
      .from("source_products")
      .update({ manual_lock: locked })
      .eq("id", productId);
  } catch {
    /* non-fatal */
  }
}