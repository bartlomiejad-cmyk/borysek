import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ProductCardWide } from "@/components/product/ProductCardWide";
import { heroProduct, heroWideFields } from "@/data/demo-products";

const TOTAL = heroWideFields.length;
const STEP_MS = 450;
const PAUSE_MS = 2500;

/** Karta hero: komórki wypełniają się po kolei, na końcu pojawia się ikona i błysk. */
export function HeroDemo() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [shine, setShine] = useState(0);

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
      for (let i = 1; i <= TOTAL + 1; i++) schedule(() => setStep(i), STEP_MS * i);
      schedule(() => setShine((n) => n + 1), STEP_MS * (TOTAL + 1) + 200);
      schedule(runCycle, STEP_MS * (TOTAL + 1) + PAUSE_MS);
    };
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  const filled = Math.min(step, TOTAL);
  const showImage = step > TOTAL;

  return (
    <div className="relative flex w-full items-center justify-center py-6">
      {/* Aurora za kartą */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="lp-aurora-a absolute left-1/2 top-1/2"
          style={{
            width: 420,
            height: 320,
            marginLeft: -210,
            marginTop: -160,
            opacity: 0.35,
            filter: "blur(60px)",
            background: "radial-gradient(closest-side, var(--accent), rgba(0,188,135,0))",
          }}
        />
        <div
          className="lp-aurora-b absolute left-1/2 top-1/2"
          style={{
            width: 300,
            height: 300,
            marginLeft: -110,
            marginTop: -100,
            opacity: 0.25,
            filter: "blur(60px)",
            background: "radial-gradient(closest-side, var(--accent-hover), rgba(0,214,154,0))",
          }}
        />
      </div>

      <div className="lp-card-float relative w-full" style={{ maxWidth: 460 }}>
        <div className="relative overflow-hidden" style={{ borderRadius: 24 }}>
          <ProductCardWide filled={filled} icon={heroProduct.icon} showImage={showImage} />
          {shine > 0 && !reduced ? (
            <span
              key={shine}
              aria-hidden
              className="lp-shine-run pointer-events-none absolute inset-y-0 left-0"
              style={{
                width: "40%",
                background:
                  "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0) 100%)",
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default HeroDemo;
