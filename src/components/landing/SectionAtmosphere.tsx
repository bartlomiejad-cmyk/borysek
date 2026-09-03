import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BarcodeTexture } from "./BarcodeTexture";

const BEAM_H = 140;
const BEAM_MS = 2400;
const BEAM_INTERVAL_MS = 9000;
const BEAM_FIRST_DELAY_MS = 1500;

/** Poziomy pas skanujący przechodzący przez sekcję co 9 s. */
function ScanBeam() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    let first: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (first) clearTimeout(first);
      if (interval) clearInterval(interval);
      first = null;
      interval = null;
    };
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        if (first || interval) return;
        first = setTimeout(() => {
          setRun((n) => n + 1);
          interval = setInterval(() => setRun((n) => n + 1), BEAM_INTERVAL_MS);
        }, BEAM_FIRST_DELAY_MS);
      } else {
        stop();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, [reduced]);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {!reduced && run > 0 ? (
        <motion.div
          key={run}
          className="absolute left-0 w-full"
          style={{
            height: BEAM_H,
            top: -BEAM_H,
            background:
              "linear-gradient(to bottom, rgba(0,188,135,0), rgba(0,188,135,0.10), rgba(0,188,135,0))",
            willChange: "transform",
          }}
          initial={{ y: 0 }}
          animate={{ y: height + BEAM_H }}
          transition={{ duration: BEAM_MS / 1000, ease: "easeInOut" }}
        />
      ) : null}
    </div>
  );
}

/** Tło sekcji: statyczna tekstura kodu kreskowego + pas skanujący. */
export function SectionAtmosphere() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" style={{ zIndex: 0 }}>
      <BarcodeTexture />
      <ScanBeam />
    </div>
  );
}

export default SectionAtmosphere;
