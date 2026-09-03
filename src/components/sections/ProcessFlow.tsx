import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Reveal } from "@/components/ui-custom/Reveal";
import { ACTOR_LABEL, processSteps, type ProcessStep } from "@/data/process-steps";
import { StepPreview } from "./ProcessStepPreview";

function StepCard({ step }: { step: ProcessStep }) {
  const human = step.actor === "human";
  const accent = step.actor === "ai";
  return (
    <article
      className="lp-glass lp-step-card grid h-full"
      style={{
        gridTemplateRows: "32px 28px 44px 1fr 120px",
        alignItems: "start",
        padding: 22,
        borderRadius: 20,
        background: "var(--glass-bg)",
        border: human ? "1.5px solid rgba(179,186,193,0.6)" : "1px solid var(--glass-border)",
        boxShadow: "var(--glass-highlight), var(--glass-shadow)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="lp-step-num flex items-center justify-center rounded-full border text-[13px]"
          style={{
            height: 28,
            width: 28,
            borderColor: "var(--glass-border-strong)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-display)",
            fontWeight: 600,
          }}
        >
          {step.index}
        </span>
        <span
          className="lp-step-pill inline-flex items-center justify-center text-[0.8125rem] font-medium"
          style={{
            width: 84,
            height: 26,
            borderRadius: "var(--radius-pill)",
            background: accent ? "var(--accent-soft)" : "var(--glass-bg)",
            color: accent ? "var(--accent)" : "var(--text-secondary)",
            border: accent ? "1px solid transparent" : "1px solid var(--glass-border)",
            fontFamily: "var(--font-body)",
          }}
        >
          {ACTOR_LABEL[step.actor]}
        </span>
      </div>

      <h3
        className="lp-step-title w-full truncate whitespace-nowrap text-[18px]"
        style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)", fontWeight: 600 }}
      >
        {step.title}
      </h3>

      <p
        className="lp-step-text text-[14px] leading-relaxed"
        style={{
          color: "var(--text-secondary)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {step.sentence}
      </p>

      <span aria-hidden />

      <StepPreview preview={step.preview} />
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

        <div
          className="lp-section-body grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          style={{ gap: 20 }}
        >
          {processSteps.map((step, i) => (
            <Reveal key={step.id} index={i} className="h-full">
              <StepCard step={step} />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

export default ProcessFlow;
