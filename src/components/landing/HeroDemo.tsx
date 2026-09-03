import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ProductCardWide } from "@/components/product/ProductCardWide";
import { heroProduct, heroWideFields } from "@/data/demo-products";

const TOTAL = heroWideFields.length;
const STEP_MS = 450;
const PAUSE_MS = 2500;

/** Karta hero: komórki wypełniają się po kolei, na końcu pojawia się zdjęcie. */
export function HeroDemo() {
  const reduced = useReducedMotion();
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
      for (let i = 1; i <= TOTAL + 1; i++) schedule(() => setStep(i), STEP_MS * i);
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
  const image = heroProduct.imageMain ?? heroProduct.imageScene;

  return (
    <div className="relative flex w-full items-center justify-center py-6">
      <div
        aria-hidden
        className="pointer-events-none absolute h-[16rem] w-[16rem] rounded-full opacity-35 sm:h-[24rem] sm:w-[24rem]"
        style={{
          background: "radial-gradient(closest-side, var(--accent), rgba(0,188,135,0))",
          filter: "blur(90px)",
        }}
      />
      <div className="relative w-full" style={{ maxWidth: 460 }}>
        <ProductCardWide
          filled={filled}
          image={image}
          imageAlt={heroProduct.name}
          showImage={showImage}
        />
      </div>
    </div>
  );
}

export default HeroDemo;
