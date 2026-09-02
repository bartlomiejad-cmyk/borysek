import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { Pill } from "@/components/ui-custom/Pill";
import { AccentButton, GhostButton } from "@/components/ui-custom/Buttons";
import { HeroDemo } from "@/components/landing/HeroDemo";

const rise = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, delay: i * 0.08, ease: "easeOut" as const },
});

const bullets = ["Bez zobowiązań", "Akceptujesz przed publikacją", "Publikujemy za Ciebie"];

const scrollTo = (id: string) =>
  document.querySelector(id)?.scrollIntoView({ behavior: "smooth" });

export function Hero() {
  return (
    <section id="top" className="relative pt-16 pb-16 md:pt-24">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[55fr_45fr]">
          <div className="flex flex-col items-start gap-6">
            <motion.div {...rise(0)}>
              <Pill variant="accent" icon={Sparkles}>
                Usługa dla sklepów internetowych
              </Pill>
            </motion.div>

            <motion.h1 {...rise(1)} className="lp-h1" style={{ color: "var(--text-primary)", textWrap: "balance" }}>
              Uzupełnimy karty produktowe w Twoim sklepie. Setki produktów, dni zamiast miesięcy.
            </motion.h1>

            <motion.p {...rise(2)} className="lp-lead max-w-xl" style={{ color: "var(--text-secondary)" }}>
              Dajesz nam dostęp do sklepu albo plik z produktami. Dostajesz gotowe nazwy, opisy,
              cechy, treści SEO i zdjęcia produktowe, sprawdzone przez ludzi i opublikowane w
              Twoim sklepie.
            </motion.p>

            <motion.div {...rise(3)} className="flex flex-wrap items-center gap-3">
              <AccentButton size="lg" onClick={() => scrollTo("#contact")}>
                Bezpłatna próbka: 5 produktów
              </AccentButton>
              <GhostButton size="lg" onClick={() => scrollTo("#cases")}>
                Zobacz realizacje
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
      </Container>
    </section>
  );
}

export default Hero;
