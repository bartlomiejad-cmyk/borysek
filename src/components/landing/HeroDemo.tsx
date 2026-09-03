import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product/ProductCard";
import { ProductPlaceholderImage } from "@/components/product/ProductIcon";
import { buildFields, FIELD_ORDER, heroProduct } from "@/data/demo-products";

const TOTAL = FIELD_ORDER.length;
const STEP_MS = 520;
const PAUSE_MS = 2500;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** step: 0 = pusta karta, 1..TOTAL = pola uzupełniane przez AI, TOTAL+1 = opublikowana */
export function HeroDemo() {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduced) {
      setStep(TOTAL + 1);
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (fn: () => void, ms: number) => {
      timers.push(setTimeout(() => !cancelled && fn(), ms));
    };
    const runCycle = () => {
      setStep(0);
      for (let i = 1; i <= TOTAL; i++) schedule(() => setStep(i), STEP_MS * i);
      schedule(() => setStep(TOTAL + 1), STEP_MS * (TOTAL + 1));
      schedule(runCycle, STEP_MS * (TOTAL + 1) + PAUSE_MS);
    };
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  const done = step > TOTAL;
  const filled = Math.min(step, TOTAL);
  const fields = done ? buildFields(TOTAL, "verified") : buildFields(filled, "ai");
  const showImage = filled >= 4;

  return (
    <div className="relative flex w-full items-center justify-center py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute h-[13rem] w-[13rem] rounded-full opacity-30 sm:h-[22rem] sm:w-[22rem] sm:opacity-40"
        style={{
          background: "radial-gradient(closest-side, var(--accent), rgba(0,188,135,0))",
          filter: "blur(90px)",
        }}
      />
      <div
        aria-hidden
        className="lp-glass pointer-events-none absolute hidden h-[70%] w-[380px] border sm:block"
        style={{
          transform: "translate(0, 22px) scale(0.86)",
          opacity: 0.3,
          background: "var(--glass-bg)",
          borderColor: "var(--glass-border)",
          borderRadius: "var(--radius-card)",
        }}
      />
      <div
        aria-hidden
        className="lp-glass pointer-events-none absolute hidden h-[80%] w-[400px] border sm:block"
        style={{
          transform: "translate(0, 12px) scale(0.94)",
          opacity: 0.5,
          background: "var(--glass-bg)",
          borderColor: "var(--glass-border)",
          borderRadius: "var(--radius-card)",
        }}
      />
      <div className="relative w-full max-w-[420px] lg:w-[420px]">
        <ProductCard
          title={done ? "Gotowe do sprzedaży" : "Nowy"}
          badge={done ? { text: "Opublikowano w sklepie", variant: "accent" } : undefined}
          image={showImage ? <ProductPlaceholderImage icon={heroProduct.icon} /> : undefined}
          fields={fields}
          highlight={done ? "accent" : "none"}
          width="100%"
          hero
        />
      </div>
    </div>
  );
}

export default HeroDemo;
