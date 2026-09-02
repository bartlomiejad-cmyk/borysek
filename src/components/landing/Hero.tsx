import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { Pill } from "@/components/ui-custom/Pill";
import { AccentButton, GhostButton } from "@/components/ui-custom/Buttons";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { shopIntegrations } from "@/data/demo-products";

const rise = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, delay: i * 0.08, ease: "easeOut" as const },
});

const bullets = ["Bez karty na start", "Działa z Twoim sklepem", "Edytujesz przed publikacją"];

function TrustBar() {
  return (
    <motion.div {...rise(6)} className="mt-16 flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
      <span className="lp-caption" style={{ color: "var(--text-muted)" }}>
        Działa z
      </span>
      <div className="flex flex-wrap items-center gap-2.5">
        {shopIntegrations.map((s) => (
          <span
            key={s.name}
            className="inline-flex items-center gap-2 border px-3.5 py-1.5 text-sm backdrop-blur-[20px]"
            style={{
              borderRadius: "var(--radius-pill)",
              background: "var(--glass-bg)",
              borderColor: "var(--glass-border)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-body)",
            }}
          >
            {s.available ? (
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            ) : null}
            {s.name}
            <span className="text-xs" style={{ color: s.available ? "var(--accent)" : "var(--text-muted)" }}>
              {s.available ? "dostępne" : "wkrótce"}
            </span>
          </span>
        ))}
      </div>
    </motion.div>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative pt-16 pb-20 md:pt-24">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[55fr_45fr]">
          <div className="flex flex-col items-start gap-6">
            <motion.div {...rise(0)}>
              <Pill variant="accent" icon={Sparkles}>
                Generowanie oparte o Claude
              </Pill>
            </motion.div>

            <motion.h1 {...rise(1)} className="lp-h1" style={{ color: "var(--text-primary)", textWrap: "balance" }}>
              Kompletne karty produktowe w minuty, nie w dni.
            </motion.h1>

            <motion.p {...rise(2)} className="lp-lead max-w-xl" style={{ color: "var(--text-secondary)" }}>
              Wklej adres produktu albo podepnij sklep. AI uzupełni nazwę, opis, cechy i SEO,
              a Ty tylko sprawdzisz i wyślesz do sklepu jednym kliknięciem.
            </motion.p>

            <motion.div {...rise(3)} className="flex flex-wrap items-center gap-3">
              <AccentButton size="lg">Wypróbuj za darmo</AccentButton>
              <GhostButton
                size="lg"
                onClick={() => document.querySelector("#flow")?.scrollIntoView({ behavior: "smooth" })}
              >
                Zobacz, jak to działa
              </GhostButton>
            </motion.div>

            <motion.ul {...rise(4)} className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {bullets.map((b) => (
                <li
                  key={b}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} style={{ color: "var(--accent)" }} />
                  {b}
                </li>
              ))}
            </motion.ul>
          </div>

          <motion.div {...rise(5)} className="flex justify-center lg:justify-end">
            <HeroDemo />
          </motion.div>
        </div>

        <TrustBar />
      </Container>
    </section>
  );
}

export default Hero;
