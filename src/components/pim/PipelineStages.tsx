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
  count: (s: PipelineSummary) => number;
  substatus: (s: PipelineSummary) => string;
  // For "next step" recommendation — pending count that drives the CTA.
  pending: (s: PipelineSummary) => number;
  ctaLabel: string;
  nextSentence: (n: number) => string;
};

const STAGES: Stage[] = [
  {
    key: "IMPORT",
    n: 1,
    title: "Import",
    Icon: Upload,
    count: (s) => s.total,
    substatus: (s) => (s.total === 0 ? "brak produktów" : `${s.total} produktów`),
    pending: (s) => (s.total === 0 ? 1 : 0),
    ctaLabel: "Zaimportuj produkty",
    nextSentence: () => "Zacznij od zaimportowania produktów z CSV lub linków.",
  },
  {
    key: "SOURCES",
    n: 2,
    title: "Źródła",
    Icon: Search,
    count: (s) => s.imported,
    substatus: (s) => (s.imported ? `${s.imported} bez źródeł` : "wszystkie mają źródła"),
    pending: (s) => s.imported,
    ctaLabel: "Wyszukaj źródła",
    nextSentence: (n) => `${n} produktów bez źródeł — uruchom wyszukiwanie Firecrawl.`,
  },
  {
    key: "MATCH",
    n: 3,
    title: "Dopasowanie",
    Icon: Link2,
    count: (s) => s.sources_found,
    substatus: (s) => (s.sources_found ? `${s.sources_found} do dopasowania` : "wszystko dopasowane"),
    pending: (s) => s.sources_found,
    ctaLabel: "Dopasuj",
    nextSentence: (n) => `${n} produktów oczekuje na dopasowanie źródeł.`,
  },
  {
    key: "CONTENT",
    n: 4,
    title: "Treści",
    Icon: Sparkles,
    count: (s) => s.matched,
    substatus: (s) => (s.matched ? `${s.matched} do generacji` : "złote rekordy gotowe"),
    pending: (s) => s.matched,
    ctaLabel: "Generuj złote rekordy",
    nextSentence: (n) => `${n} produktów gotowych do generacji złotego rekordu.`,
  },
  {
    key: "MEDIA",
    n: 5,
    title: "Media",
    Icon: ImageIcon,
    count: (s) => s.golden_ready,
    substatus: (s) => (s.golden_ready ? `${s.golden_ready} do regeneracji/wizualizacji` : "media gotowe"),
    pending: (s) => s.golden_ready,
    ctaLabel: "Regeneruj tła",
    nextSentence: (n) => `${n} produktów oczekuje na regenerację teł lub wizualizacje.`,
  },
  {
    key: "REVIEW",
    n: 6,
    title: "Review",
    Icon: ShieldCheck,
    count: (s) => s.review_queue,
    substatus: (s) =>
      s.review_queue
        ? `${s.review_queue} do weryfikacji · ${s.review_approved} zatwierdzonych`
        : `${s.review_approved} zatwierdzonych`,
    pending: (s) => s.review_queue,
    ctaLabel: "Weryfikuj zdjęcia AI",
    nextSentence: (n) => `${n} produktów do weryfikacji przez zespół.`,
  },
];

export function PipelineStages({
  summary,
  activeStage,
  onStageClick,
  onPrimaryAction,
}: {
  summary: PipelineSummary;
  activeStage: StageKey;
  onStageClick: (stage: Exclude<StageKey, "NONE">) => void;
  onPrimaryAction: (stage: Exclude<StageKey, "NONE">) => void;
}) {
  // Determine "next step": the earliest stage with the largest pending count.
  let best: Stage | null = null;
  let bestPending = 0;
  for (const stg of STAGES) {
    const p = stg.pending(summary);
    if (p > bestPending) {
      best = stg;
      bestPending = p;
    }
  }

  return (
    <section className="mb-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {STAGES.map((stg) => {
          const isActive = activeStage === stg.key;
          const isBest = best?.key === stg.key;
          const Icon = stg.Icon;
          return (
            <button
              key={stg.key}
              type="button"
              onClick={() => onStageClick(stg.key)}
              className={cn(
                "text-left rounded-xl border p-3 transition-all bg-card hover:bg-accent/40",
                isActive
                  ? "border-primary ring-2 ring-primary/40 bg-primary/5"
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
              </div>
              <div className="mt-2 font-serif text-3xl leading-none">
                {stg.count(summary)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
                {stg.substatus(summary)}
              </div>
            </button>
          );
        })}
      </div>

      {best && bestPending > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/50 bg-amber-500/5 px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold">Następny krok · Etap {best.n} {best.title}:</span>{" "}
            <span className="text-muted-foreground">{best.nextSentence(bestPending)}</span>
          </div>
          <Button size="sm" onClick={() => onPrimaryAction(best!.key)}>
            {best.ctaLabel} ({bestPending}) <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
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