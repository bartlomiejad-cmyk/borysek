import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowRight, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { ProductCard } from "@/components/product/ProductCard";
import { Pill } from "@/components/ui-custom/Pill";
import { fieldsFromValues, FIELD_ORDER } from "@/data/demo-products";
import type { CaseStudy } from "@/data/case-studies";

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[1.75rem] font-bold leading-none"
        style={{ fontFamily: "var(--font-display)", color: "var(--accent)" }}
      >
        {value}
      </span>
      <span className="lp-caption" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

function CaseProductCard({
  state,
  caption,
  after,
}: {
  state: CaseStudy["before"];
  caption: string;
  after?: boolean;
}) {
  const fields = fieldsFromValues(
    state.values,
    after ? "verified" : "ai",
    FIELD_ORDER.length,
  );
  return (
    <div className="flex flex-col items-center gap-2">
      <div style={{ zoom: 0.78 }}>
        <ProductCard
          title="Ergo Watch PRO"
          fields={fields}
          completeness={state.completeness}
          highlight={after ? "accent" : "none"}
          width={240}
        />
      </div>
      <span className="lp-caption" style={{ color: "var(--text-muted)" }}>
        {caption}
      </span>
    </div>
  );
}

function ArrowBadge() {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
      style={{ background: "var(--accent-soft)" }}
    >
      <ArrowRight className="h-4 w-4 md:block hidden" style={{ color: "var(--accent)" }} />
      <ArrowDown className="h-4 w-4 md:hidden" style={{ color: "var(--accent)" }} />
    </span>
  );
}

export function CaseStudyCard({
  study,
  defaultOpen,
}: {
  study: CaseStudy;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);

  return (
    <div
      className="relative border backdrop-blur-[20px] p-6 md:p-10"
      style={{
        background: "var(--glass-bg)",
        borderColor: "var(--glass-border)",
        borderRadius: 32,
        boxShadow: "var(--glass-highlight), var(--glass-shadow)",
      }}
    >
      {/* Header — always visible */}
      <div className="flex flex-wrap items-center gap-2">
        <Pill variant="neutral">{study.industry}</Pill>
        <Pill variant="neutral">{study.platform}</Pill>
      </div>
      <h3 className="lp-h3 mt-4" style={{ color: "var(--text-primary)" }}>
        {study.client}
      </h3>
      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-4">
        <MiniStat value={study.productsCount} label="produktów" />
        <MiniStat value={study.durationDays} label="dni" />
        <MiniStat value={String(study.scope.length)} label="zakresy" />
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-8 grid gap-10 md:grid-cols-[55%_1fr]">
              <div className="flex flex-col gap-6">
                <ul className="flex flex-wrap gap-2">
                  {study.scope.map((item) => (
                    <Pill key={item} variant="neutral" icon={Check} className="[&_svg]:text-[var(--accent)]">
                      {item}
                    </Pill>
                  ))}
                </ul>
                <p className="lp-body" style={{ color: "var(--text-primary)" }}>
                  {study.result}
                </p>
                {study.quote ? (
                  <blockquote className="flex flex-col gap-2">
                    <p
                      className="lp-body italic"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      „{study.quote.text}"
                    </p>
                    <footer className="lp-caption" style={{ color: "var(--text-muted)" }}>
                      {study.quote.author} — {study.quote.role}
                    </footer>
                  </blockquote>
                ) : null}
              </div>

              <div className="flex flex-col items-center justify-center gap-3 md:flex-row md:items-start">
                <CaseProductCard state={study.before} caption="Przed" />
                <ArrowBadge />
                <CaseProductCard state={study.after} caption="Po" after />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-6 inline-flex items-center gap-2 text-[0.9375rem] font-medium transition-colors"
        style={{ color: "var(--accent)", fontFamily: "var(--font-body)" }}
        aria-expanded={open}
      >
        {open ? "Ukryj szczegóły" : "Pokaż szczegóły"}
        <ChevronDown
          className="h-4 w-4 transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
    </div>
  );
}

export default CaseStudyCard;
