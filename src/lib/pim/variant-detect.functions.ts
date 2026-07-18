import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  detectVariantGroupsPhase1,
  type VariantRowInput,
  type VariantGroup,
} from "./variant-detect";

/**
 * Pattern-based variant detection v2. Runs Phase 1 (deterministic
 * grouping) over source_products for a project, then optionally Phase 2
 * (LLM assist) on rows Phase 1 left ungrouped.
 *
 * Skips rows that:
 *   - are already row_kind='variant' (already classified);
 *   - have manual_lock=true (user pinned them).
 *
 * Idempotent: on re-run, previously applied groups have their variant
 * rows filtered out and no longer surface as proposals.
 */

type Candidate = {
  id: string;
  nazwa: string | null;
  kod: string | null;
  ean: string | null;
  row_kind: string | null;
  manual_lock: boolean | null;
  excluded: boolean | null;
  excluded_reason: string | null;
};

export type ProposedGroup = {
  baseName: string;
  baseKod: string | null;
  parentId: string | null;
  variantIds: string[];
  missingParent: boolean;
  source: "phase1" | "phase2_ai";
};

const asProposals = (
  groups: VariantGroup[],
  rows: Candidate[],
  source: "phase1" | "phase2_ai",
): ProposedGroup[] =>
  groups.map((g) => ({
    baseName: g.baseName,
    baseKod: g.baseKod,
    parentId: g.parentIndex !== null ? rows[g.parentIndex].id : null,
    variantIds: g.variantIndices.map((i) => rows[i].id),
    missingParent: g.missingParent,
    source,
  }));

const CANDIDATE_COLS =
  "id, nazwa, kod, ean, row_kind, manual_lock, excluded, excluded_reason";

const loadCandidates = async (
  supabase: { from: (t: string) => unknown },
  projectId: string,
): Promise<Candidate[]> => {
  const { data, error } = await (
    supabase.from("source_products") as unknown as {
      select: (s: string) => { eq: (c: string, v: string) => { limit: (n: number) => Promise<{ data: Candidate[] | null; error: { message: string } | null }> } };
    }
  )
    .select(CANDIDATE_COLS)
    .eq("project_id", projectId)
    .limit(20000);
  if (error) throw new Error(error.message);
  return (data ?? []).filter(
    (r) => (r.row_kind ?? "main") !== "variant" && !r.manual_lock,
  );
};

const runPhase2Ai = async (
  ungrouped: Candidate[],
): Promise<VariantGroup[]> => {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey || ungrouped.length < 2) return [];

  const CHUNK = 200;
  const groups: VariantGroup[] = [];
  for (let start = 0; start < ungrouped.length; start += CHUNK) {
    const slice = ungrouped.slice(start, start + CHUNK);
    const items = slice.map((r, i) => ({ i, nazwa: r.nazwa ?? "", kod: r.kod ?? "" }));
    const system =
      "Jesteś asystentem porządkowania danych produktowych. Rozpoznajesz warianty rozmiarowe i kolorystyczne tego samego produktu na podstawie nazwy i kodu SKU.";
    const user = [
      "Pogrupuj pozycje będące wariantami rozmiarowymi/kolorystycznymi tego samego produktu.",
      "Zwróć wyłącznie JSON o schemacie: {\"groups\":[{\"parent_i\":number|null,\"variant_is\":number[]}]}.",
      "Grupuj TYLKO przy wyraźnym wzorcu wariantowym (różnica wyłącznie w rozmiarze, kolorze lub oznaczeniu wariantu). W razie wątpliwości pozostaw pozycje osobno (nie umieszczaj ich w żadnej grupie).",
      "Nie twórz grup jednoelementowych.",
      "",
      "Pozycje:",
      JSON.stringify(items),
    ].join("\n");

    let parsed: { groups?: Array<{ parent_i?: number | null; variant_is?: number[] }> } | null = null;
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "raw",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        console.warn("[variant-detect] phase2 gateway non-ok", res.status);
        continue;
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content ?? "";
      parsed = JSON.parse(content);
    } catch (e) {
      console.warn("[variant-detect] phase2 failed", e instanceof Error ? e.message : String(e));
      continue;
    }

    for (const g of parsed?.groups ?? []) {
      const parentI = typeof g.parent_i === "number" ? g.parent_i : null;
      const variantIs = (g.variant_is ?? []).filter((n) => Number.isInteger(n));
      if (variantIs.length < 1) continue;
      // Map slice-local indices back to Candidate.id ordering: build a
      // fake VariantGroup with slice-relative indices; caller resolves via
      // slice[] not the full array — so wrap now.
      const parentId = parentI !== null ? slice[parentI]?.id : null;
      const variantIds = variantIs
        .map((i) => slice[i]?.id)
        .filter((v): v is string => typeof v === "string");
      if (!variantIds.length) continue;
      // Emit as a VariantGroup with absolute-in-slice indices. We pass
      // asProposals a matched Candidate[] later, so translate now to
      // ProposedGroup directly rather than VariantGroup.
      groups.push({
        baseName: slice[parentI ?? variantIs[0]]?.nazwa ?? "",
        baseKod: slice[parentI ?? variantIs[0]]?.kod ?? null,
        parentIndex: parentI,
        variantIndices: variantIs,
        missingParent: parentI === null,
      });
      // Store the slice reference on the group by encoding IDs in place of
      // indices via a side channel: the caller (proposeVariantGroups) knows
      // to translate `phase2` groups differently. We instead push a fully
      // resolved ProposedGroup via a side array.
      (groups[groups.length - 1] as unknown as { _resolved?: { parentId: string | null; variantIds: string[] } })._resolved = {
        parentId: parentId ?? null,
        variantIds,
      };
    }
  }
  return groups;
};

export const proposeVariantGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ projectId: z.string().uuid(), useAi: z.boolean().default(true) }).parse(i))
  .handler(async ({ data, context }): Promise<{ proposals: ProposedGroup[]; totalCandidates: number; phase1Count: number; phase2Count: number }> => {
    const { supabase } = context;
    const rows = await loadCandidates(supabase as never, data.projectId);
    const inputs: VariantRowInput[] = rows.map((r) => ({ id: r.id, nazwa: r.nazwa, kod: r.kod }));
    const { groups, ungroupedIndices } = detectVariantGroupsPhase1(inputs);
    const phase1 = asProposals(groups, rows, "phase1");

    let phase2: ProposedGroup[] = [];
    if (data.useAi && ungroupedIndices.length >= 2) {
      const ungrouped = ungroupedIndices.map((i) => rows[i]);
      const aiGroups = await runPhase2Ai(ungrouped);
      // aiGroups carry a _resolved side channel with actual product ids.
      for (const g of aiGroups) {
        const resolved = (g as unknown as { _resolved?: { parentId: string | null; variantIds: string[] } })._resolved;
        if (!resolved) continue;
        // Filter out ids already covered by phase1 to keep proposals disjoint.
        const phase1Ids = new Set<string>();
        for (const p of phase1) {
          if (p.parentId) phase1Ids.add(p.parentId);
          for (const v of p.variantIds) phase1Ids.add(v);
        }
        const cleanVariants = resolved.variantIds.filter((v) => !phase1Ids.has(v));
        const parentId = resolved.parentId && !phase1Ids.has(resolved.parentId) ? resolved.parentId : null;
        if (cleanVariants.length < 1) continue;
        phase2.push({
          baseName: g.baseName,
          baseKod: g.baseKod,
          parentId,
          variantIds: cleanVariants,
          missingParent: parentId === null,
          source: "phase2_ai",
        });
      }
    }

    return {
      proposals: [...phase1, ...phase2],
      totalCandidates: rows.length,
      phase1Count: phase1.length,
      phase2Count: phase2.length,
    };
  });

const groupSchema = z.object({
  parentId: z.string().uuid().nullable(),
  variantIds: z.array(z.string().uuid()).min(1),
  baseName: z.string().default(""),
  baseKod: z.string().nullable().default(null),
  createSyntheticParent: z.boolean().default(false),
});

export const applyVariantGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    projectId: z.string().uuid(),
    groups: z.array(groupSchema).min(1).max(500),
  }).parse(i))
  .handler(async ({ data, context }): Promise<{ variants: number; syntheticParents: number; groups: number }> => {
    const { supabase } = context;
    // Atomic apply via SECURITY DEFINER RPC (per-project advisory lock).
    // Mirrors the previous TS semantics byte-for-byte, but rolls back the
    // whole batch on any mid-loop failure. See migration
    // 20260718170000_apply_variant_groups_tx.sql.
    const { data: rpcData, error: rpcErr } = await (
      supabase as unknown as {
        rpc: (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc("apply_variant_groups_tx", {
      p_project_id: data.projectId,
      p_groups: data.groups,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    const out = (rpcData ?? {}) as {
      variants?: number;
      syntheticParents?: number;
      groups?: number;
      variantIds?: string[];
    };
    const variants = Number(out.variants ?? 0);
    const syntheticParents = Number(out.syntheticParents ?? 0);
    const affected = Array.isArray(out.variantIds) ? out.variantIds : [];

    // Best-effort per-variant events (post-commit; failures never
    // roll back the classification).
    try {
      const { logProductEvent } = await import("./product-events.server");
      const parentByVariant = new Map<string, string | null>();
      for (const g of data.groups) {
        for (const vid of g.variantIds) {
          parentByVariant.set(vid, g.baseKod ?? null);
        }
      }
      for (const vid of affected) {
        const parentKod = parentByVariant.get(vid) ?? null;
        await logProductEvent(supabase as never, {
          projectId: data.projectId,
          productId: vid,
          kind: "manual_edit",
          message: `Reklasyfikacja (wzorzec): wariant${parentKod ? ` (parent_sku=${parentKod})` : ""}`,
          meta: { action: "variant_detect_v2_apply", parent_sku: parentKod, source: "user_confirmed" },
        });
      }
    } catch { /* best-effort */ }

    return { variants, syntheticParents, groups: data.groups.length };
  });

/**
 * Manual mass action: mark products as variants of a chosen parent.
 * Independent of automatic detection.
 */
export const markProductsAsVariantsOf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    projectId: z.string().uuid(),
    parentId: z.string().uuid(),
    productIds: z.array(z.string().uuid()).min(1).max(500),
  }).parse(i))
  .handler(async ({ data, context }): Promise<{ updated: number; parentKod: string | null }> => {
    const { supabase } = context;
    const { data: parent, error: pErr } = await (
      supabase.from("source_products") as unknown as {
        select: (s: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string; kod: string | null; project_id: string } | null; error: { message: string } | null }> } };
      }
    ).select("id, kod, project_id").eq("id", data.parentId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!parent || parent.project_id !== data.projectId) throw new Error("Nieprawidłowy produkt główny");
    const parentKod = parent.kod ?? null;
    const productIds = data.productIds.filter((p) => p !== data.parentId);
    if (!productIds.length) return { updated: 0, parentKod };

    // Do not touch manual_lock rows.
    const { data: victims, error: vErr } = await (
      supabase.from("source_products") as unknown as {
        select: (s: string) => { in: (c: string, v: string[]) => { eq: (c: string, v: string) => Promise<{ data: Array<{ id: string; manual_lock: boolean | null }> | null; error: { message: string } | null }> } };
      }
    ).select("id, manual_lock").in("id", productIds).eq("project_id", data.projectId);
    if (vErr) throw new Error(vErr.message);
    const eligible = (victims ?? []).filter((v) => !v.manual_lock).map((v) => v.id);
    if (!eligible.length) return { updated: 0, parentKod };

    const patch = {
      row_kind: "variant",
      parent_sku: parentKod,
      excluded: true,
      excluded_reason: "variant",
      excluded_at: new Date().toISOString(),
    };
    const { data: updated, error: uErr } = await (
      supabase.from("source_products") as unknown as {
        update: (p: unknown) => { in: (c: string, v: string[]) => { select: (s: string) => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }> } };
      }
    ).update(patch as unknown).in("id", eligible).select("id");
    if (uErr) throw new Error(uErr.message);

    // Log events (best-effort).
    try {
      const { logProductEvent } = await import("./product-events.server");
      for (const row of updated ?? []) {
        await logProductEvent(supabase as never, {
          projectId: data.projectId,
          productId: row.id,
          kind: "manual_edit",
          message: `Oznaczono jako wariant${parentKod ? ` (parent_sku=${parentKod})` : ""}`,
          meta: { action: "mark_as_variant_manual", parent_sku: parentKod },
        });
      }
    } catch { /* best-effort */ }

    return { updated: (updated ?? []).length, parentKod };
  });