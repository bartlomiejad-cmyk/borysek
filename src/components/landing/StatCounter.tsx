import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

type StatCounterProps = {
  /** Number animates from 0; a string (e.g. "[LICZBA]") renders as-is. */
  value: number | string;
  prefix?: string;
  suffix?: string;
  size?: string;
};

export function StatCounter({
  value,
  prefix = "",
  suffix = "",
  size = "clamp(2.5rem, 4vw, 3.5rem)",
}: StatCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const numeric = typeof value === "number";
  const [display, setDisplay] = useState(numeric && !reduced ? 0 : value);

  useEffect(() => {
    if (!numeric) {
      setDisplay(value);
      return;
    }
    if (!inView) return;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const duration = 1200;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round((value as number) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, value, numeric]);

  return (
    <span
      ref={ref}
      className="block font-[Sora,system-ui] font-bold leading-none"
      style={{
        color: "var(--accent)",
        fontSize: size,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

export default StatCounter;
