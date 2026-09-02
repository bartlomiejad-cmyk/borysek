import { useState, type CSSProperties, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";


/** Wspólna krzywa i czas wejścia dla całej strony /landing. */
export const REVEAL_EASE = [0.2, 0.8, 0.2, 1] as const;
export const REVEAL_DURATION = 0.5;
export const REVEAL_DURATION_REDUCED = 0.2;
export const REVEAL_STAGGER = 0.07;

type RevealOptions = {
  /** Pozycja elementu w grupie — steruje opóźnieniem (stagger 70 ms). */
  index?: number;
  /** Ile procent elementu musi być widoczne, zanim ruszy animacja. */
  amount?: number;
};

/**
 * Jedyny hook wejścia sekcji na landingu: fade + 16px w górę, 0,5 s,
 * uruchamiany raz. Przy prefers-reduced-motion: sam fade 0,2 s.
 */
export function useReveal({ index = 0, amount = 0.2 }: RevealOptions = {}) {
  const reduced = useReducedMotion();

  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 16 },
    whileInView: reduced ? { opacity: 1 } : { opacity: 1, y: 0 },
    viewport: { once: true, amount } as const,
    transition: {
      duration: reduced ? REVEAL_DURATION_REDUCED : REVEAL_DURATION,
      delay: reduced ? 0 : index * REVEAL_STAGGER,
      ease: reduced ? ("linear" as const) : REVEAL_EASE,
    },
  };
}

type RevealProps = RevealOptions & {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

/**
 * Opakowanie dla pojedynczego elementu wejściowego.
 * will-change ustawiamy tylko na czas animacji (Safari).
 */
export function Reveal({ index, amount, className, style, children }: RevealProps) {
  const reveal = useReveal({ index, amount });
  const [animating, setAnimating] = useState(true);

  return (
    <motion.div
      initial={reveal.initial}
      whileInView={reveal.whileInView}
      viewport={reveal.viewport}
      transition={reveal.transition}
      className={className}
      style={{ willChange: animating ? "opacity, transform" : undefined, ...style }}
      onAnimationComplete={() => setAnimating(false)}
    >
      {children}
    </motion.div>
  );
}


export default Reveal;
