import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  runGenerateGoldenRecord,
  runRegenerateMedia,
  runFirecrawlDiscovery,
  runPhotoToolGenerate,
  runPhotoToolEditImage,
  runPimVisualization,
  runPimAllegroDescription,
  runPimRescrape,
  runPimImageVerify,
  runPimAudit,
  type WorkerCtx,
} from "@/lib/pim/_workers.server";

// Total budget per request (Worker hard limit is ~30s). We process items
// sequentially and stop early if we'd risk timing out.
const BUDGET_MS = 25_000;

type JobKind =
  | "GENERATE_GOLDEN"
  | "REGENERATE_MEDIA"
  | "FIRECRAWL_DISCOVERY"
  | "PHOTO_TOOL_GENERATE"
  | "PHOTO_TOOL_EDIT_IMAGE"
  | "PIM_VISUALIZATIONS"
  | "PIM_ALLEGRO_DESCRIPTION"
  | "PIM_RESCRAPE"
  | "PIM_IMAGE_VERIFY"
  | "PIM_AUDIT";

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
  payload: Record<string, unknown> | null;
  lock_token?: string | null;
};

async function processItem(
  kind: JobKind,
  productId: string,
  ctx: WorkerCtx,
  payload: Record<string, unknown> | null,
): Promise<{ complete: boolean }> {
  switch (kind) {
    case "GENERATE_GOLDEN":
      // Verification of source images is a separate, opt-in action. Bulk
      // golden generation must stay fast so the queue does not appear stuck.
      await runGenerateGoldenRecord(productId, "all", ctx);
      return { complete: true };
    case "REGENERATE_MEDIA":
      await runRegenerateMedia(productId, ctx, {
        maxGallery:
          typeof payload?.maxGallery === "number" ? (payload.maxGallery as number) : undefined,
        targetResolution:
          typeof payload?.targetResolution === "number"
            ? (payload.targetResolution as number)
            : undefined,
      });
      return { complete: true };
    case "FIRECRAWL_DISCOVERY":
      await runFirecrawlDiscovery(productId, ctx);
      return { complete: true };
    case "PHOTO_TOOL_GENERATE":
      await runPhotoToolGenerate(productId, ctx);
      return { complete: true };
    case "PHOTO_TOOL_EDIT_IMAGE": {
      const slot = (payload?.slot as "thumbnail" | "lifestyle") ?? "thumbnail";
      const idx = typeof payload?.lifestyleIndex === "number" ? (payload!.lifestyleIndex as number) : 0;
      const requirementsPl = typeof payload?.requirementsPl === "string" ? (payload!.requirementsPl as string) : "";
      await runPhotoToolEditImage(productId, { slot, lifestyleIndex: idx, requirementsPl }, ctx);
      return { complete: true };
    }
    case "PIM_VISUALIZATIONS": {
      return await runPimVisualization(productId, ctx, {
        count: typeof payload?.count === "number" ? (payload.count as number) : 0,
        requirementsPl: typeof payload?.requirementsPl === "string" ? (payload.requirementsPl as string) : "",
        stylePrompt: typeof payload?.stylePrompt === "string" ? (payload.stylePrompt as string) : "",
        targetResolution:
          typeof payload?.targetResolution === "number" ? (payload.targetResolution as number) : undefined,
        force_reanalyze: payload?.force_reanalyze === true,
      });
    }
    case "PIM_ALLEGRO_DESCRIPTION":
      await runPimAllegroDescription(productId, ctx);
      return { complete: true };
    case "PIM_RESCRAPE":
      await runPimRescrape(productId, ctx);
      return { complete: true };
    case "PIM_IMAGE_VERIFY":
      await runPimImageVerify(productId, ctx, {
        force: payload?.force === true,
      });
      return { complete: true };
    case "PIM_AUDIT":
      await runPimAudit(productId, ctx);
      return { complete: true };
    default:
      throw new Error(`Unknown job kind: ${kind as string}`);
  }
}

async function pickNextJob(): Promise<BulkJobRow | null> {
  // Atomic FOR UPDATE SKIP LOCKED claim via SQL function. Two concurrent
  // hook ticks can never receive the same job; stale locks (>3 min) are
  // reclaimable. Falls back to the old query if the RPC is unavailable
  // (e.g. pre-migration environments) so the worker keeps running.
  const { data, error } = (await supabaseAdmin.rpc("claim_next_bulk_job" as never, {
    p_stale_seconds: 180,
  } as never)) as { data: unknown; error: { message: string } | null };
  if (!error && Array.isArray(data) && data.length > 0) {
    return (data[0] as unknown) as BulkJobRow;
  }
  if (error) {
    // Log once and continue with a non-locking read so we don't stall the
    // queue if the function is missing during a rolling deploy.
    console.warn("[bulk-jobs] claim_next_bulk_job unavailable:", error.message);
  }
  const { data: fallback } = await supabaseAdmin
    .from("bulk_jobs" as never)
    .select("id, project_id, kind, items, total, processed_count, failed_count, cancel_requested, status, last_error, payload")
    .in("status", ["PENDING", "PROCESSING"])
    .eq("cancel_requested", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (fallback as unknown as BulkJobRow) ?? null;
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

    const pid = remaining[0]!;
    const shiftBeforeProcessing = job.kind !== "PIM_VISUALIZATIONS";
    if (shiftBeforeProcessing) {
      remaining.shift();
    }
    // Persist the shifted queue BEFORE processing. PHOTO_TOOL_GENERATE can
    // take longer than the Worker's 30s hard limit; if we only persist after
    // processItem returns, a hard timeout leaves pid in `items`, the next
    // cron tick re-picks it and the whole product restarts from scratch
    // (miniaturka → wizualizacja 1 → hard kill → miniaturka again…).
    // Removing it up front means at-most-once processing per pickup. PIM
    // visualizations are different: a single FAL render can outlive this
    // request, so the product stays in the queue until all slots are saved.
    if (shiftBeforeProcessing) {
      await supabaseAdmin
        .from("bulk_jobs" as never)
        .update({ items: remaining as never } as never)
        .eq("id", job.id);
    }
    const ctx: WorkerCtx = {
      deadline,
      bulkJobId: job.id,
      bulkPayload: job.payload,
      onEvent: async (e) => {
        try {
          await supabaseAdmin.from("bulk_job_events" as never).insert({
            job_id: job.id,
            project_id: job.project_id,
            source_product_id: pid,
            level: e.level,
            message: e.message,
            details: (e.details ?? {}) as never,
          } as never);
        } catch {
          /* logging must never break the worker */
        }
      },
    };
    try {
      const itemResult = await processItem(job.kind, pid, ctx, job.payload);
      if (itemResult.complete) {
        if (!shiftBeforeProcessing) remaining.shift();
        processed++;
      } else {
        break;
      }
    } catch (e) {
      if (!shiftBeforeProcessing) remaining.shift();
      failed++;
      lastError = e instanceof Error ? e.message : String(e);
      await ctx.onEvent?.({ level: "error", message: `❌ ${lastError}` });
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
          // Housekeeping on idle ticks: purge product events older than 90 days.
          try {
            const { cleanupOldProductEvents } = await import(
              "@/lib/pim/product-events.server"
            );
            await cleanupOldProductEvents(supabaseAdmin);
          } catch {
            /* housekeeping is best-effort */
          }
          return Response.json({ ok: true, picked: 0 });
        }

        const result = await processJob(job, deadline);

        // Decide terminal state.
        let patch: Record<string, unknown> | null = null;
        if (result.cancelled) {
          patch = { status: "CANCELLED", finished_at: new Date().toISOString() };
        } else if (result.remaining.length === 0) {
          const totalProcessed = job.processed_count + result.processed;
          const totalFailed = job.failed_count + result.failed;
          patch = {
            status: totalProcessed === 0 && totalFailed > 0 ? "FAILED" : "COMPLETED",
            finished_at: new Date().toISOString(),
          };
        }
        if (patch) {
          await supabaseAdmin
            .from("bulk_jobs" as never)
            .update(patch as never)
            .eq("id", job.id);
        } else if (job.kind === "PIM_VISUALIZATIONS" && result.remaining.length > 0) {
          // FAL visualizations can span multiple request windows. Kick the
          // worker again immediately (cron remains the fallback) so completed
          // queue renders are polled, uploaded, and saved without waiting.
          const apikey = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (apikey) {
            void fetch(new URL(request.url).toString(), {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey },
              body: "{}",
            }).catch(() => undefined);
          }
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