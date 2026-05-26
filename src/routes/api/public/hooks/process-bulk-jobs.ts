import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  runGenerateGoldenRecord,
  runRegenerateMedia,
} from "@/lib/pim/_workers.server";

// Total budget per request (Worker hard limit is ~30s). We process items
// sequentially and stop early if we'd risk timing out.
const BUDGET_MS = 25_000;

type JobKind = "GENERATE_GOLDEN" | "REGENERATE_MEDIA";

type BulkJobRow = {
  id: string;
  project_id: string;
  kind: JobKind;
  items: string[] | null;
  total: number;
  processed_count: number;
  failed_count: number;
  cancel_requested: boolean;
  status: string;
  last_error: string | null;
};

async function processItem(kind: JobKind, productId: string): Promise<void> {
  if (kind === "GENERATE_GOLDEN") {
    // Verification of source images is a separate, opt-in action. Bulk
    // golden generation must stay fast so the queue does not appear stuck.
    await runGenerateGoldenRecord(productId, "all");
  } else {
    await runRegenerateMedia(productId);
  }
}

async function pickNextJob(): Promise<BulkJobRow | null> {
  const { data } = await supabaseAdmin
    .from("bulk_jobs" as never)
    .select("id, project_id, kind, items, total, processed_count, failed_count, cancel_requested, status, last_error")
    .in("status", ["PENDING", "PROCESSING"])
    .eq("cancel_requested", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as unknown as BulkJobRow) ?? null;
}

async function processJob(job: BulkJobRow, deadline: number): Promise<{
  processed: number;
  failed: number;
  remaining: string[];
  cancelled: boolean;
}> {
  const remaining = [...(job.items ?? [])];
  let processed = 0;
  let failed = 0;
  let lastError: string | null = null;
  let cancelled = false;

  // Mark job as PROCESSING + started_at on first pickup.
  if (job.status !== "PROCESSING") {
    await supabaseAdmin
      .from("bulk_jobs" as never)
      .update({ status: "PROCESSING", started_at: new Date().toISOString() } as never)
      .eq("id", job.id);
  }

  while (remaining.length) {
    if (Date.now() > deadline) break;

    // Re-check cancel flag before each item.
    const { data: cancelCheck } = await supabaseAdmin
      .from("bulk_jobs" as never)
      .select("cancel_requested")
      .eq("id", job.id)
      .maybeSingle();
    if ((cancelCheck as { cancel_requested?: boolean } | null)?.cancel_requested) {
      cancelled = true;
      break;
    }

    const pid = remaining.shift()!;
    try {
      await processItem(job.kind, pid);
      processed++;
    } catch (e) {
      failed++;
      lastError = e instanceof Error ? e.message : String(e);
    }

    // Persist progress + remaining queue after every item so refreshes
    // can never lose work and Zatrzymaj is honored quickly.
    await supabaseAdmin
      .from("bulk_jobs" as never)
      .update({
        items: remaining as never,
        processed_count: job.processed_count + processed,
        failed_count: job.failed_count + failed,
        last_error: lastError,
      } as never)
      .eq("id", job.id);
  }

  return { processed, failed, remaining, cancelled };
}

export const Route = createFileRoute("/api/public/hooks/process-bulk-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // pg_cron passes Supabase anon key in `apikey` header — verify before doing anything.
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const deadline = Date.now() + BUDGET_MS;
        const job = await pickNextJob();
        if (!job) {
          return Response.json({ ok: true, picked: 0 });
        }

        const result = await processJob(job, deadline);

        // Decide terminal state.
        let patch: Record<string, unknown> | null = null;
        if (result.cancelled) {
          patch = { status: "CANCELLED", finished_at: new Date().toISOString() };
        } else if (result.remaining.length === 0) {
          patch = { status: "COMPLETED", finished_at: new Date().toISOString() };
        }
        if (patch) {
          await supabaseAdmin
            .from("bulk_jobs" as never)
            .update(patch as never)
            .eq("id", job.id);
        }

        return Response.json({
          ok: true,
          jobId: job.id,
          processed: result.processed,
          failed: result.failed,
          remaining: result.remaining.length,
          cancelled: result.cancelled,
        });
      },
    },
  },
});