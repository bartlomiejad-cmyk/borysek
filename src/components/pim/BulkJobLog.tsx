import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Level = "info" | "success" | "warn" | "error";

// Human-readable label per bulk job kind. PIM_RESCRAPE is the adaptive
// top-up job triggered when matching leaves too few strong sources.
export const BULK_JOB_KIND_LABELS: Record<string, string> = {
  GENERATE_GOLDEN: "Generacja złotych rekordów",
  REGENERATE_MEDIA: "Regeneracja zdjęć",
  FIRECRAWL_DISCOVERY: "Wyszukiwanie źródeł (Firecrawl)",
  PHOTO_TOOL_GENERATE: "Generowanie zdjęć",
  PHOTO_TOOL_EDIT_IMAGE: "Edycja zdjęcia",
  PIM_VISUALIZATIONS: "Wizualizacje produktowe",
  PIM_ALLEGRO_DESCRIPTION: "Opisy Allegro",
  PIM_RESCRAPE: "Doscrapowanie źródeł",
  PIM_IMAGE_VERIFY: "Weryfikacja zdjęć AI",
};

type EventRow = {
  id: string;
  level: Level;
  message: string;
  created_at: string;
};

const LEVEL_CLASS: Record<Level, string> = {
  info: "text-foreground/80",
  success: "text-emerald-500",
  warn: "text-amber-500",
  error: "text-destructive",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Live tail of bulk_job_events for one job. Initial fetch + realtime
 * subscription (with 3s polling fallback). Auto-scrolls to bottom unless
 * the user scrolled up manually.
 */
export function BulkJobLog({ jobId }: { jobId: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      const { data } = await supabase
        .from("bulk_job_events" as never)
        .select("id, level, message, created_at")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      const rows = ((data ?? []) as unknown as EventRow[]).slice().reverse();
      setEvents(rows);
    }

    fetchInitial();

    const channel = supabase
      .channel(`bulk-job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bulk_job_events", filter: `job_id=eq.${jobId}` },
        (payload) => {
          const row = payload.new as unknown as EventRow;
          setEvents((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            const next = [...prev, row];
            return next.length > 300 ? next.slice(next.length - 300) : next;
          });
        },
      )
      .subscribe();

    // Fallback polling — in case realtime is unavailable / dropped.
    const poll = setInterval(fetchInitial, 4000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events]);

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickToBottomRef.current = atBottom;
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="mt-2 max-h-56 overflow-y-auto rounded border bg-muted/30 px-3 py-2 font-mono text-xs leading-relaxed"
    >
      {events.length === 0 ? (
        <div className="text-muted-foreground">Czekam na pierwsze zdarzenia…</div>
      ) : (
        events.map((e) => (
          <div key={e.id} className={LEVEL_CLASS[e.level] ?? "text-foreground/80"}>
            <span className="text-muted-foreground">{fmtTime(e.created_at)}</span>{" "}
            <span className="whitespace-pre-wrap break-words">{e.message}</span>
          </div>
        ))
      )}
    </div>
  );
}