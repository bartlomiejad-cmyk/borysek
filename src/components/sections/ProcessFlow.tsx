import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Reveal } from "@/components/ui-custom/Reveal";
import { ProductCardWide, type WideCell } from "@/components/product/ProductCardWide";
import { ProcessSceneView } from "./ProcessScene";
import { heroWideFields, espressoValues } from "@/data/demo-products";
import {
  ACTOR_LABEL,
  CLICK_PAUSE_MS,
  RAW_NAME,
  RESUME_DELAY_MS,
  STEP_DURATION_MS,
  STEP_PAUSE_MS,
  processSteps,
  type ProcessStep,
} from "@/data/process-steps";

const LAST = processSteps.length - 1;

/** Wartość pola w karcie dla danego kroku. */
function valueFor(label: string, step: ProcessStep): string | null {
  if (step.index <= 2 && label === "Nazwa") return RAW_NAME;
  const hero = heroWideFields.find((f) => f.label === label);
  if (hero) return hero.value;
  return espressoValues[label] ?? null;
}

function cellsFor(step: ProcessStep, revealed: number): WideCell[] {
  return heroWideFields.map((f) => {
    const pos = step.filled.indexOf(f.label);
    const on = pos >= 0 && (!step.sequential || pos < revealed);
    return {
      label: f.label,
      value: on ? valueFor(f.label, step) : null,
      status: on ? step.status : "empty",
    };
  });
}

function StepRow({
  step,
  active,
  progress,
  onSelect,
}: {
  step: ProcessStep;
  active: boolean;
  progress: boolean;
  onSelect: () => void;
}) {
  const human = step.actor === "human";
  const accentPill = step.actor === "ai";
  const markerBg = human ? "var(--text-primary)" : "var(--accent)";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className="grid w-full text-left"
      style={{
        padding: "14px 16px",
        borderRadius: 14,
        minHeight: 72,
        gridTemplateColumns: "32px 1fr",
        gap: 14,
        alignItems: "start",
        background: active ? "var(--glass-bg-strong)" : "transparent",
        borderLeft: active
          ? `3px solid ${human ? "var(--text-secondary)" : "var(--accent)"}`
          : "3px solid transparent",
        transition: "background 220ms ease, border-color 220ms ease",
      }}
    >
      <span
        className="flex items-center justify-center rounded-full text-[13px]"
        style={{
          height: 28,
          width: 28,
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          background: active ? markerBg : "transparent",
          color: active ? "#04110C" : "var(--text-secondary)",
          border: active ? "1px solid transparent" : "1px solid var(--glass-border-strong)",
          transition: "background 220ms ease, color 220ms ease",
        }}
      >
        {step.index}
      </span>

      <span className="min-w-0">
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span
            className="truncate whitespace-nowrap text-[16px]"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {step.title}
          </span>
          <span
            className="inline-flex shrink-0 items-center px-2.5 text-[11px] font-medium"
            style={{
              height: 22,
              borderRadius: "var(--radius-pill)",
              background: accentPill ? "var(--accent-soft)" : "var(--glass-bg-strong)",
              color: accentPill ? "var(--accent)" : "var(--text-secondary)",
              border: accentPill ? "1px solid transparent" : "1px solid var(--glass-border)",
              fontFamily: "var(--font-body)",
            }}
          >
            {ACTOR_LABEL[step.actor]}
          </span>
        </span>
        <span
          className="mt-1 block text-[13.5px] leading-snug"
          style={{
            color: "var(--text-secondary)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {step.sentence}
        </span>
        {active ? (
          <span
            aria-hidden
            className="mt-2 block w-full overflow-hidden rounded-full"
            style={{ height: 2, background: "var(--glass-border-strong)" }}
          >
            <motion.span
              key={`${step.id}-${progress}`}
              className="block h-full rounded-full"
              style={{ background: "var(--accent)", transformOrigin: "left" }}
              initial={{ scaleX: progress ? 0 : 1 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: progress ? STEP_DURATION_MS / 1000 : 0, ease: "linear" }}
            />
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ProcessFlow() {
  const reduced = useReducedMotion() ?? false;
  const [current, setCurrent] = useState(reduced ? LAST : 0);
  const [revealed, setRevealed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holdUntil, setHoldUntil] = useState(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const step = processSteps[current]!;
  const playing = !reduced && !paused && Date.now() >= holdUntil;

  useEffect(() => {
    if (reduced) setCurrent(LAST);
  }, [reduced]);

  // Autoodtwarzanie
  useEffect(() => {
    if (!playing) return;
    const delay = current === LAST ? STEP_DURATION_MS + STEP_PAUSE_MS : STEP_DURATION_MS;
    const t = setTimeout(() => setCurrent((c) => (c + 1) % processSteps.length), delay);
    return () => clearTimeout(t);
  }, [playing, current, holdUntil]);

  // Sekwencyjne wypełnianie pól w kroku 3
  useEffect(() => {
    if (!step.sequential) return;
    if (reduced) {
      setRevealed(step.filled.length);
      return;
    }
    setRevealed(0);
    const timers = step.filled.map((_, i) =>
      setTimeout(() => setRevealed(i + 1), 120 * (i + 1)),
    );
    return () => timers.forEach(clearTimeout);
  }, [step, reduced]);

  const select = useCallback((i: number) => {
    setCurrent(i);
    setHoldUntil(Date.now() + CLICK_PAUSE_MS);
  }, []);

  const onEnter = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    setPaused(true);
  };
  const onLeave = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setPaused(false), RESUME_DELAY_MS);
  };

  useEffect(() => () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      select((current + 1) % processSteps.length);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      select((current - 1 + processSteps.length) % processSteps.length);
    }
  };

  const cells = cellsFor(step, revealed);

  return (
    <section id="flow" className="relative lp-section">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Jak pracujemy"
            title="Jeden produkt. Sześć kroków. Zobacz, co dzieje się w każdym."
            lead="Kliknij krok albo pozwól, żeby karta po prawej przeszła całą drogę sama."
          />
        </Reveal>

        <div
          className="lp-section-body grid items-center gap-10 lg:grid-cols-[44%_56%]"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          {/* Lista kroków: chipy na mobile, wiersze od lg */}
          <div
            role="tablist"
            aria-label="Kroki procesu"
            onKeyDown={onKeyDown}
            className="order-1 -mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2 lg:order-none lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {processSteps.map((s, i) => (
              <div key={s.id} className="w-[260px] shrink-0 snap-start lg:w-auto lg:shrink">
                <StepRow
                  step={s}
                  active={i === current}
                  progress={playing}
                  onSelect={() => select(i)}
                />
              </div>
            ))}
          </div>

          <div className="order-2 flex w-full flex-col items-center lg:order-none">
            <ProductCardWide
              cells={cells}
              caption={step.caption}
              pill={step.pill}
              pillAccent={step.pillAccent}
              accentBorder={Boolean(step.accentBorder)}
              scene={<ProcessSceneView scene={step.scene} />}
            />
            <div
              className="mt-3 flex w-full items-center gap-2 overflow-hidden"
              style={{ maxWidth: 460, height: 24 }}
            >
              <span style={{ color: "var(--accent)", fontFamily: "var(--font-body)" }}>&gt;</span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={step.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0 truncate text-[12.5px]"
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    color: "var(--text-secondary)",
                  }}
                >
                  {step.log}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

export default ProcessFlow;
