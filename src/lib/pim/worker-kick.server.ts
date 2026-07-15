import { getRequest } from "@tanstack/react-start/server";

const BULK_WORKER_PATH = "/api/public/hooks/process-bulk-jobs";
const DEV_WORKER_ORIGIN = "https://project--a56746f2-6fdf-47b1-8095-043a41af98fd-dev.lovable.app";

function currentOrigin(): string | null {
  try {
    const request = getRequest();
    return request?.url ? new URL(request.url).origin : null;
  } catch {
    return null;
  }
}

export function bulkWorkerUrl(): string {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const origin = configured || currentOrigin() || DEV_WORKER_ORIGIN;
  return `${origin}${BULK_WORKER_PATH}`;
}

export function kickBulkWorker(): void {
  const apikey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!apikey) return;

  void fetch(bulkWorkerUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: "{}",
  }).catch(() => undefined);
}