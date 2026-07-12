import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BulkJobKind =
  | "GENERATE_GOLDEN"
  | "REGENERATE_MEDIA"
  | "FIRECRAWL_DISCOVERY"
  | "PHOTO_TOOL_GENERATE"
  | "PHOTO_TOOL_EDIT_IMAGE"
  | "PIM_VISUALIZATIONS"
  | "PIM_ALLEGRO_DESCRIPTION";
export type BulkJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export type BulkJob = {
  id: string;
  project_id: string;
  user_id: string;
  kind: BulkJobKind;
  items: string[];
  total: number;
  processed_count: number;
  failed_count: number;
  status: BulkJobStatus;
  cancel_requested: boolean;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

const KindSchema = z.enum([
  "GENERATE_GOLDEN",
  "REGENERATE_MEDIA",
  "FIRECRAWL_DISCOVERY",
  "PHOTO_TOOL_GENERATE",
  "PHOTO_TOOL_EDIT_IMAGE",
  "PIM_VISUALIZATIONS",
  "PIM_ALLEGRO_DESCRIPTION",
]);

function mapRow(row: Record<string, unknown>): BulkJob {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    user_id: row.user_id as string,
    kind: row.kind as BulkJobKind,
    items: Array.isArray(row.items) ? (row.items as string[]) : [],
    total: (row.total as number) ?? 0,
    processed_count: (row.processed_count as number) ?? 0,
    failed_count: (row.failed_count as number) ?? 0,
    status: row.status as BulkJobStatus,
    cancel_requested: !!row.cancel_requested,
    last_error: (row.last_error as string | null) ?? null,
    started_at: (row.started_at as string | null) ?? null,
    finished_at: (row.finished_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export const createBulkJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        kind: KindSchema,
        items: z.array(z.string().uuid()).min(1).max(20000),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Check there isn't already an active job of this kind for this project.
    // Per-image edits are cheap and independent, so we allow many in parallel.
    if (data.kind !== "PHOTO_TOOL_EDIT_IMAGE") {
      const { data: existing } = await supabase
        .from("bulk_jobs" as never)
        .select("id, status")
        .eq("project_id", data.projectId)
        .eq("kind", data.kind)
        .in("status", ["PENDING", "PROCESSING"])
        .maybeSingle();
      if (existing) {
        throw new Error(
          "Zadanie tego typu już działa w tle dla tego projektu. Poczekaj na zakończenie lub je zatrzymaj.",
        );
      }
    }

    const { data: row, error } = await supabase
      .from("bulk_jobs" as never)
      .insert({
        project_id: data.projectId,
        user_id: userId,
        kind: data.kind,
        items: data.items as never,
        total: data.items.length,
        payload: (data.payload ?? null) as never,
      } as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    // Kick the worker immediately so the user does not wait for the next
    // cron tick. Failure here is non-fatal — the cron will pick the job up.
    try {
      const base =
        process.env.PUBLIC_APP_URL ||
        "https://project--a56746f2-6fdf-47b1-8095-043a41af98fd.lovable.app";
      const apikey = process.env.SUPABASE_PUBLISHABLE_KEY;
      if (apikey) {
        void fetch(`${base}/api/public/hooks/process-bulk-jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey },
          body: "{}",
        }).catch(() => {});
      }
    } catch {
      // ignore — cron will catch up
    }
    return mapRow(row as Record<string, unknown>);
  });

export const getActiveBulkJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ projectId: z.string().uuid(), kind: KindSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // Get the most recently created job for (project, kind). If it's still
    // PENDING/PROCESSING the UI shows progress. Terminal states are returned
    // too so the UI can flash a one-shot result toast then disappear.
    const { data: row } = await context.supabase
      .from("bulk_jobs" as never)
      .select("*")
      .eq("project_id", data.projectId)
      .eq("kind", data.kind)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return row ? mapRow(row as Record<string, unknown>) : null;
  });

export const cancelBulkJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ jobId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // PENDING jobs were never picked up by the worker, so flip them straight
    // to CANCELLED — otherwise the UI shows a non-cancellable "Zatrzymywanie…"
    // forever. PROCESSING jobs only get a cancel flag; the worker finishes
    // the current item and ends the job.
    const { error: e1 } = await context.supabase
      .from("bulk_jobs" as never)
      .update({
        status: "CANCELLED",
        cancel_requested: true,
        finished_at: new Date().toISOString(),
      } as never)
      .eq("id", data.jobId)
      .eq("status", "PENDING");
    if (e1) throw new Error(e1.message);

    const { error: e2 } = await context.supabase
      .from("bulk_jobs" as never)
      .update({
        status: "CANCELLED",
        cancel_requested: true,
        finished_at: new Date().toISOString(),
      } as never)
      .eq("id", data.jobId)
      .eq("status", "PROCESSING");
    if (e2) throw new Error(e2.message);
    return { ok: true };
  });