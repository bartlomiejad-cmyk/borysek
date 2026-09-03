import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";

/** Deterministyczny PRNG (mulberry32), żeby układ nie migotał między renderami. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Particle = {
  left: number;
  top: number;
  circle: boolean;
  angle: number;
  fall: number;
  sway: number;
  delay: number;
};

function build(count: number, seed: number): Particle[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => ({
    left: r() * 100,
    top: r() * 100,
    circle: r() > 0.5,
    angle: Math.round(r() * 360),
    fall: 18 + r() * 14,
    sway: 4 + r() * 3,
    delay: -r() * 30,
  }));
}

/** Warstwa dekoracyjnych cząstek na tle sekcji. */
export function ConfettiLayer({ seed = 1 }: { seed?: number }) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(36);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setCount(mq.matches ? 90 : 36);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const particles = useMemo(() => build(count, seed), [count, seed]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {particles.map((p, i) => (
        <span
          key={i}
          className={reduced ? undefined : "lp-confetti-fall"}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: `${p.top}%`,
            animationDuration: `${p.fall}s`,
            animationDelay: `${p.delay}s`,
          }}
        >
          <span
            className={reduced ? undefined : "lp-confetti-sway"}
            style={{
              display: "block",
              animationDuration: `${p.sway}s`,
              animationDelay: `${p.delay}s`,
            }}
          >
            <span
              style={{
                display: "block",
                width: 6,
                height: p.circle ? 6 : 10,
                borderRadius: p.circle ? "50%" : 2,
                background: "var(--accent)",
                opacity: 0.5,
                transform: `rotate(${p.angle}deg)`,
              }}
            />
          </span>
        </span>
      ))}
    </div>
  );
}

export default ConfettiLayer;
