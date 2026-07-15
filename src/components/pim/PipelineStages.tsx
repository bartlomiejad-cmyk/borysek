import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Search,
  Link2,
  Sparkles,
  ImageIcon,
  ShieldCheck,
  ArrowRight,
  Check,
  ClipboardCheck,
} from "lucide-react";
import type { PipelineSummary } from "@/lib/pim/queries.functions";

export type StageKey =
  | "NONE"
  | "IMPORT"
  | "SOURCES"
  | "MATCH"
  | "CONTENT"
  | "MEDIA"
  | "REVIEW";

type Stage = {
  key: Exclude<StageKey, "NONE">;
  n: number;
  title: string;
  Icon: typeof Upload;
  // Cumulative done / total for this stage.
  progress: (s: PipelineSummary) => { done: number; total: number };
  // Immediate pending count at this stage (drives "next step" + substatus).
  pending: (s: PipelineSummary) => number;
  // Substatus text when stage is not yet complete.
  remainingLabel: (pending: number) => string;
  ctaLabel: string;
  nextSentence: (n: number) => string;
};

const STAGES: Stage[] = [
  {
    key: "IMPORT",
    n: 1,
    title: "Import",
    Icon: Upload,
    progress: (s) => ({ done: s.total, total: Math.max(s.total, 1) }),
    pending: (s) => (s.total === 0 ? 1 : 0),
    remainingLabel: () => "brak produktów",
    ctaLabel: "Zaimportuj produkty",
    nextSentence: () => "Zacznij od zaimportowania produktów z CSV lub linków.",
  },
  {
    key: "SOURCES",
    n: 2,
    title: "Źródła",
    Icon: Search,
    progress: (s) => ({ done: Math.max(0, s.total - s.imported), total: s.total }),
    pending: (s) => s.imported,
    remainingLabel: (n) => `${n} bez źródeł`,
    ctaLabel: "Wyszukaj źródła",
    nextSentence: (n) => `${n} produktów bez źródeł — uruchom wyszukiwanie Firecrawl.`,
  },
  {
    key: "MATCH",
    n: 3,
    title: "Dopasowanie",
    Icon: Link2,
    progress: (s) => ({
      done: Math.max(0, s.total - s.imported - s.sources_found),
      total: s.total,
    }),
    pending: (s) => s.sources_found,
    remainingLabel: (n) => `${n} do dopasowania`,
    ctaLabel: "Dopasuj",
    nextSentence: (n) => `${n} produktów oczekuje na dopasowanie źródeł.`,
  },
  {
    key: "CONTENT",
    n: 4,
    title: "Treści",
    Icon: Sparkles,
    progress: (s) => ({
      done: Math.max(0, s.total - s.imported - s.sources_found - s.matched),
      total: s.total,
    }),
    pending: (s) => s.matched,
    remainingLabel: (n) => `${n} do generacji`,
    ctaLabel: "Generuj złote rekordy",
    nextSentence: (n) => `${n} produktów gotowych do generacji złotego rekordu.`,
  },
  {
    key: "MEDIA",
    n: 5,
    title: "Media",
    Icon: ImageIcon,
    progress: (s) => ({ done: s.visuals_ready, total: s.total }),
    pending: (s) => s.golden_ready,
    remainingLabel: (n) => `${n} do generacji mediów`,
    ctaLabel: "Regeneruj tła",
    nextSentence: (n) => `${n} produktów do generacji mediów (miniatury lub wizualizacje AI).`,
  },
  {
    key: "REVIEW",
    n: 6,
    title: "Review",
    Icon: ShieldCheck,
    progress: (s) => ({ done: s.review_approved, total: s.total }),
    pending: (s) => s.review_queue,
    remainingLabel: (n) => `${n} do weryfikacji`,
    ctaLabel: "Weryfikuj zdjęcia AI",
    nextSentence: (n) => `${n} produktów do weryfikacji przez zespół.`,
  },
];

export function PipelineStages({
  summary,
  onPrimaryAction,
  onShowPending,
  onRunAudit,
  onShowExcluded,
}: {
  summary: PipelineSummary;
  onPrimaryAction: (stage: Exclude<StageKey, "NONE">) => void;
  onShowPending?: (stage: Exclude<StageKey, "NONE">) => void;
  /**
   * Optional handler for the "run AI audit" CTA in the Review stage. When
   * provided AND audits have not yet been run on the eligible set, the
   * Review "next step" strip switches to prompting an audit run first.
   */
  onRunAudit?: () => void;
  onShowExcluded?: () => void;
}) {
  // Determine "next step": the earliest stage with pending work. Later stages
  // may have more items, but they depend on earlier blockers being cleared
  // first (e.g. 27 missing sources must stay actionable even if 47 products
  // are already waiting for matching).
  let best: Stage | null = null;
  let bestPending = 0;
  for (const stg of STAGES) {
    const p = stg.pending(summary);
    if (p > 0) {
      best = stg;
      bestPending = p;
      break;
    }
  }

  // Audit-first override for Review: if there are audit-eligible products
  // that haven't been audited yet, prompt for Audyt AI before manual review.
  const auditEligible = summary.audit_eligible ?? 0;
  const auditCompleted = summary.audit_completed ?? 0;
  const auditPending = Math.max(0, auditEligible - auditCompleted);
  const reviewNeedsAudit = auditPending > 0 && !!onRunAudit;

  return (
    <section className="mb-6">
      {(summary.excluded_count ?? 0) > 0 && (
        <div className="mb-2 text-xs text-muted-foreground">
          · {summary.excluded_count} poza procesem
          {onShowExcluded && (
            <>
              {" "}
              <button
                type="button"
                className="text-primary underline underline-offset-2 hover:no-underline"
                onClick={() => onShowExcluded()}
              >
                pokaż wykluczone
              </button>
            </>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {STAGES.map((stg) => {
          const isBest = best?.key === stg.key;
          const Icon = stg.Icon;
          const { done, total } = stg.progress(summary);
          const pending = stg.pending(summary);
          const complete = total > 0 && done >= total && pending === 0;
          // Review stage substatus: if there are audit-eligible products that
          // haven't been audited yet, tell the user to run Audyt AI first.
          const showAuditFirst =
            stg.key === "REVIEW" && !complete && reviewNeedsAudit;
          return (
            <div
              key={stg.key}
              className={cn(
                "rounded-xl border p-3 bg-card",
                complete
                  ? "border-emerald-400/60 bg-emerald-500/5"
                  : isBest
                  ? "border-amber-400/70"
                  : "border-border",
              )}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                  {stg.n}
                </span>
                <Icon className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">{stg.title}</span>
                {complete && (
                  <Check className="ml-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                )}
              </div>
              <div className="mt-2 font-serif text-3xl leading-none tabular-nums">
                {done}
                <span className="text-lg text-muted-foreground">/{total}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
                {complete
                  ? "gotowe"
                  : showAuditFirst
                    ? "najpierw uruchom Audyt AI"
                    : pending > 0
                      ? stg.remainingLabel(pending)
                      : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {best && bestPending > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/50 bg-amber-500/5 px-4 py-3">
          {best.key === "REVIEW" && reviewNeedsAudit ? (
            <>
              <div className="text-sm">
                <span className="font-semibold">Następny krok · Etap {best.n} {best.title}:</span>{" "}
                <span className="text-muted-foreground">
                  uruchom Audyt AI przed przeglądem ({auditPending}{" "}
                  {auditPending === 1 ? "produkt" : "produktów"}).
                </span>
              </div>
              <Button size="sm" onClick={() => onRunAudit?.()}>
                <ClipboardCheck className="mr-2 h-4 w-4" /> Audyt AI ({auditPending})
              </Button>
            </>
          ) : (
            <>
              <div className="text-sm">
                <span className="font-semibold">Następny krok · Etap {best.n} {best.title}:</span>{" "}
                <span className="text-muted-foreground">
                  {best.key === "REVIEW"
                    ? `${bestPending} produktów czeka na Twój przegląd.`
                    : best.nextSentence(bestPending)}
                </span>
                {onShowPending && best.key !== "IMPORT" && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="text-primary underline underline-offset-2 hover:no-underline"
                      onClick={() => onShowPending(best!.key)}
                    >
                      pokaż te produkty
                    </button>
                  </>
                )}
              </div>
              <Button size="sm" onClick={() => onPrimaryAction(best!.key)}>
                {best.ctaLabel} ({bestPending}) <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function stageToFilter(stage: StageKey):
  | "ALL"
  | "PIPE_IMPORTED"
  | "PIPE_SOURCES_FOUND"
  | "PIPE_MATCHED"
  | "PIPE_GOLDEN_READY"
  | "REVIEW" {
  switch (stage) {
    case "SOURCES": return "PIPE_IMPORTED";
    case "MATCH": return "PIPE_SOURCES_FOUND";
    case "CONTENT": return "PIPE_MATCHED";
    case "MEDIA": return "PIPE_GOLDEN_READY";
    case "REVIEW": return "REVIEW";
    default: return "ALL";
  }
}