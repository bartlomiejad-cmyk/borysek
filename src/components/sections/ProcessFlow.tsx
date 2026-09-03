import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Reveal } from "@/components/ui-custom/Reveal";
import { Pill } from "@/components/ui-custom/Pill";
import { ACTOR_LABEL, processSteps, type ProcessStep } from "@/data/process-steps";
import { StepPreview } from "./ProcessStepPreview";

const GRID = "grid gap-6 md:grid-cols-3 lg:grid-cols-6";

function StepCard({ step }: { step: ProcessStep }) {
  const human = step.actor === "human";
  return (
    <article
      className="lp-glass flex h-full flex-col p-5"
      style={{
        background: "var(--glass-bg)",
        border: human ? "1.5px solid var(--text-secondary)" : "1px solid var(--glass-border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--glass-highlight), var(--glass-shadow)",
      }}
    >
      <div className="flex h-8 items-center justify-between gap-3">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full border text-[12px]"
          style={{
            borderColor: "var(--glass-border-strong)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-body)",
          }}
        >
          {step.index}
        </span>
        <Pill
          variant={step.actor === "ai" ? "accent" : "neutral"}
          className="w-[88px] justify-center"
        >
          {ACTOR_LABEL[step.actor]}
        </Pill>
      </div>

      <h3
        className="mt-4 flex min-h-[64px] items-start text-[1.125rem] leading-snug"
        style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)", fontWeight: 600 }}
      >
        {step.title}
      </h3>

      <p
        className="min-h-[96px] text-[14px] leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {step.sentence}
      </p>

      <div className="mt-auto">
        <StepPreview preview={step.preview} />
      </div>
    </article>
  );
}

export function ProcessFlow() {
  return (
    <section id="flow" className="relative lp-section">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Jak pracujemy"
            title="Sześć kroków od Twojego pliku do gotowej karty."
            lead="Zielone kroki wykonuje AI, jasne wykonują ludzie: nasz redaktor i Ty."
          />
        </Reveal>

        {/* Oś czasu: pozioma na desktopie, pionowa na mobile */}
        <div className="lp-section-body relative">
          <div
            aria-hidden
            className="absolute left-0 top-[7px] hidden h-px w-full md:block"
            style={{ background: "var(--glass-border-strong)" }}
          />
          <div className={`${GRID} hidden md:grid`} aria-hidden>
            {processSteps.map((s) => (
              <span key={s.id} className="flex justify-center">
                <span
                  className="h-[7px] w-[7px] rounded-full"
                  style={{
                    background: s.actor === "ai" ? "var(--accent)" : "var(--text-secondary)",
                  }}
                />
              </span>
            ))}
          </div>

          <div className={`${GRID} mt-6`}>
            {processSteps.map((step, i) => (
              <Reveal key={step.id} index={i} className="h-full">
                <StepCard step={step} />
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

export default ProcessFlow;
