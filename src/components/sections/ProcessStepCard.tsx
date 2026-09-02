import { motion, useReducedMotion } from "framer-motion";
import { Check, Watch } from "lucide-react";
import { ProductCard } from "@/components/product/ProductCard";
import { useReveal } from "@/components/ui-custom/Reveal";
import { buildStepFields, type ProcessStep } from "@/data/process-steps";

function ProductImage() {
  return (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center"
      style={{
        background: "radial-gradient(120% 100% at 50% 0%, rgba(0,188,135,0.18), rgba(14,16,19,1) 70%)",
      }}
    >
      <Watch aria-hidden className="h-12 w-12" strokeWidth={1.25} style={{ color: "var(--accent)" }} />
    </div>
  );
}

function LifestyleImage() {
  return (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center"
      style={{ background: "linear-gradient(160deg, #1A1D22 0%, #0B0D10 100%)" }}
    >
      <span className="lp-caption" style={{ color: "var(--text-muted)" }}>
        zdjęcie aranżacyjne
      </span>
    </div>
  );
}

function PersonCard({ person }: { person: NonNullable<ProcessStep["person"]> }) {
  return (
    <div
      className="mt-3 flex items-center gap-3 border px-3.5 py-3"
      style={{
        borderRadius: "var(--radius-button)",
        borderColor: "var(--glass-border)",
        background: "var(--glass-bg)",
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px]"
        style={{
          background: "var(--amber-soft)",
          color: "var(--amber)",
          fontFamily: "var(--font-body)",
        }}
      >
        {person.initials}
      </span>
      <span className="min-w-0 flex-1" style={{ fontFamily: "var(--font-body)" }}>
        <span className="block truncate text-[13px]" style={{ color: "var(--text-primary)" }}>
          {person.name}
        </span>
        <span className="block truncate text-[12px]" style={{ color: "var(--text-muted)" }}>
          {person.role}
        </span>
      </span>
      <Check aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} style={{ color: "var(--accent)" }} />
    </div>
  );
}

type Props = {
  step: ProcessStep;
  active: boolean;
  order: number;
};

export function ProcessStepCard({ step, active, order }: Props) {
  const reduced = useReducedMotion();
  const reveal = useReveal({ index: order, amount: 0.3 });

  return (
    <motion.div
      data-step-index={step.index}
      className="shrink-0 snap-start"
      style={{ width: 280 }}
      initial={reveal.initial}
      whileInView={reveal.whileInView}
      viewport={reveal.viewport}
      transition={reveal.transition}
    >
      <motion.div
        animate={reduced ? undefined : { opacity: active ? 1 : 0.85, scale: active ? 1 : 0.97 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        style={{ transformOrigin: "center top" }}
      >
        <ProductCard
          title={step.cardTitle}
          stepNumber={step.index}
          badge={step.badge}
          image={
            step.image === "none" ? undefined : step.image === "lifestyle" ? <LifestyleImage /> : <ProductImage />
          }
          fields={buildStepFields(step)}
          completeness={step.completeness}
          highlight={step.highlight}
          width="100%"
          blur={false}
        />
        {step.person ? <PersonCard person={step.person} /> : null}
      </motion.div>
    </motion.div>
  );
}

export default ProcessStepCard;
