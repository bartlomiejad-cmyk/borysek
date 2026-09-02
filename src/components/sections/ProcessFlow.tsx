import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Reveal } from "@/components/ui-custom/Reveal";
import { processSteps } from "@/data/process-steps";
import { ProcessStepCard } from "./ProcessStepCard";
import { ProcessChevronBar } from "./ProcessChevronBar";

const CARD_STEP = 280 + 24;

const LEGEND = [
  { label: "AI", color: "var(--accent)", glow: false },
  { label: "Człowiek", color: "var(--amber)", glow: false },
  { label: "Publikacja", color: "var(--accent-hover)", glow: true },
];

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-5">
      {LEGEND.map((l) => (
        <li
          key={l.label}
          className="flex items-center gap-2 text-sm"
          style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: l.color, boxShadow: l.glow ? "0 0 12px var(--accent-glow)" : "none" }}
          />
          {l.label}
        </li>
      ))}
    </ul>
  );
}

function ArrowButton({ dir, onClick }: { dir: "left" | "right"; onClick: () => void }) {
  const Icon = dir === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "left" ? "Poprzedni krok" : "Następny krok"}
      className="lp-glass hidden h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors hover:bg-white/10 md:flex motion-reduce:transition-none"
      style={{
        borderColor: "var(--glass-border-strong)",
        background: "var(--glass-bg)",
        color: "var(--text-primary)",
      }}
    >
      <Icon aria-hidden className="h-5 w-5" />
    </button>
  );
}

export function ProcessFlow() {
  const scroller = useRef<HTMLDivElement>(null);
  const mobileBar = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(1);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-step-index]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best) setActive(Number((best.target as HTMLElement).dataset.stepIndex));
      },
      { root, threshold: [0.5, 0.75, 1], rootMargin: "0px -35% 0px -35%" },
    );
    cards.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, []);

  const syncMobileBar = useCallback(() => {
    const root = scroller.current;
    const bar = mobileBar.current;
    if (!root || !bar) return;
    const max = root.scrollWidth - root.clientWidth;
    const barMax = bar.scrollWidth - bar.clientWidth;
    if (max <= 0 || barMax <= 0) return;
    bar.scrollLeft = (root.scrollLeft / max) * barMax;
  }, []);

  const scrollBy = useCallback((delta: number) => {
    scroller.current?.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  const scrollToStep = useCallback((index: number) => {
    const root = scroller.current;
    const card = root?.querySelector<HTMLElement>(`[data-step-index="${index}"]`);
    if (!root || !card) return;
    root.scrollTo({ left: card.offsetLeft - root.offsetLeft, behavior: "smooth" });
    setActive(index);
  }, []);

  return (
    <section id="flow" className="relative py-24 md:py-32">
      <Container>
        <Reveal className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="Jak pracujemy"
            title="Od dostępu do sklepu do opublikowanej karty w ośmiu krokach."
            lead="Zielone kroki wykonuje AI. Bursztynowe wykonują ludzie: nasz zespół i Ty. Ostatni to publikacja w Twoim sklepie."
          />
          <div className="shrink-0 lg:pb-2">
            <Legend />
          </div>
        </Reveal>

        <div className="mt-12 flex items-center gap-4">
          <ArrowButton dir="left" onClick={() => scrollBy(-CARD_STEP)} />

          <div
            ref={scroller}
            onScroll={syncMobileBar}
            className="lp-no-scrollbar -mx-6 flex snap-x snap-mandatory gap-6 overflow-x-auto px-6 pb-2 md:mx-0 md:px-0"
          >
            {processSteps.map((step, i) => (
              <ProcessStepCard key={step.id} step={step} order={i} active={step.index === active} />
            ))}
          </div>

          <ArrowButton dir="right" onClick={() => scrollBy(CARD_STEP)} />
        </div>

        <ProcessChevronBar
          steps={processSteps}
          activeIndex={active}
          onSelect={scrollToStep}
          className="mt-10 hidden md:flex"
        />

        <div
          ref={mobileBar}
          className="lp-no-scrollbar pointer-events-auto -mx-6 mt-8 overflow-x-hidden px-6 md:hidden"
        >
          <ProcessChevronBar
            steps={processSteps}
            activeIndex={active}
            onSelect={scrollToStep}
            segmentWidth={200}
          />
        </div>
      </Container>
    </section>
  );
}

export default ProcessFlow;
