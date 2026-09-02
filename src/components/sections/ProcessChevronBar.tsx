import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ProcessStep, SegmentTone } from "@/data/process-steps";

const toneStyle = (tone: SegmentTone) =>
  tone === "amber"
    ? { background: "var(--amber)", boxShadow: "none" }
    : tone === "publish"
      ? { background: "var(--accent-hover)", boxShadow: "0 0 24px var(--accent-glow)" }
      : { background: "var(--accent)", boxShadow: "none" };

type Props = {
  steps: ProcessStep[];
  activeIndex: number;
  onSelect: (index: number) => void;
  className?: string;
  /** Fixed segment width used inside the horizontal (mobile) scroller. */
  segmentWidth?: number;
};

export function ProcessChevronBar({ steps, activeIndex, onSelect, className, segmentWidth }: Props) {
  const reduced = useReducedMotion();

  return (
    <div className={cn("flex items-start", className)}>
      {steps.map((step, i) => {
        const active = step.index === activeIndex;
        return (
          <motion.div
            key={step.id}
            className="flex min-w-0 flex-col gap-2"
            style={
              segmentWidth
                ? { width: segmentWidth, marginLeft: i === 0 ? 0 : -14 }
                : { flex: 1, marginLeft: i === 0 ? 0 : -14 }
            }
            initial={reduced ? false : { opacity: 0, scaleX: 0 }}
            whileInView={{ opacity: 1, scaleX: 1 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.4, delay: 0.6 + i * 0.06, ease: "easeOut" }}
          >
            <button
              type="button"
              onClick={() => onSelect(step.index)}
              aria-label={`Krok ${step.index}: ${step.caption}`}
              aria-current={active ? "step" : undefined}
              className="h-9 w-full transition-opacity duration-300 motion-reduce:transition-none"
              style={{
                ...toneStyle(step.tone),
                opacity: active ? 1 : 0.55,
                clipPath: "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)",
              }}
            />
            <div className="pr-4" style={{ paddingLeft: i === 0 ? 0 : 18 }}>
              <p className="lp-caption" style={{ color: "var(--text-primary)" }}>
                {step.caption}
              </p>
              <p
                className="mt-1 text-[12px] leading-snug"
                style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
              >
                {step.description}
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

export default ProcessChevronBar;
