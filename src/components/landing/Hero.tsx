import { Check, Sparkles } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { Pill } from "@/components/ui-custom/Pill";
import { AccentButton, GhostButton } from "@/components/ui-custom/Buttons";
import { Reveal } from "@/components/ui-custom/Reveal";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { SHOW_CASE_STUDIES } from "@/data/case-studies";

const bullets = ["Bez zobowiązań", "Akceptujesz przed publikacją", "Publikujemy za Ciebie"];

const scrollTo = (id: string) =>
  document.querySelector(id)?.scrollIntoView({ behavior: "smooth" });

export function Hero() {
  return (
    <section id="top" className="relative pt-16 pb-16 md:pt-24">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[55fr_45fr]">
          <div className="flex flex-col items-start gap-6">
            <Reveal index={0}>
              <Pill variant="accent" icon={Sparkles}>
                Usługa dla sklepów internetowych
              </Pill>
            </Reveal>

            <Reveal index={1}>
              <h1
                className="lp-h1"
                style={{ color: "var(--text-primary)", textWrap: "balance" }}
              >
                Uzupełnimy karty produktowe w Twoim sklepie. Setki produktów, dni zamiast
                miesięcy.
              </h1>
            </Reveal>

            <Reveal index={2}>
              <p className="lp-lead max-w-xl" style={{ color: "var(--text-secondary)" }}>
                Dajesz nam dostęp do sklepu albo plik z produktami. Dostajesz gotowe nazwy,
                opisy, cechy, treści SEO i zdjęcia produktowe, sprawdzone przez ludzi i
                opublikowane w Twoim sklepie.
              </p>
            </Reveal>

            <Reveal index={3} className="flex flex-wrap items-center gap-3">
              <AccentButton size="lg" onClick={() => scrollTo("#contact")}>
                Bezpłatna próbka: 5 produktów
              </AccentButton>
              <GhostButton
                size="lg"
                onClick={() => scrollTo(SHOW_CASE_STUDIES ? "#cases" : "#before-after")}
              >
                {SHOW_CASE_STUDIES ? "Zobacz realizacje" : "Zobacz przed i po"}
              </GhostButton>
            </Reveal>

            <Reveal index={4}>
              <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-center gap-2 text-sm"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
                  >
                    <Check
                      aria-hidden
                      className="h-4 w-4"
                      strokeWidth={2.5}
                      style={{ color: "var(--accent)" }}
                    />
                    {b}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal index={5} className="flex justify-center lg:justify-end">
            <HeroDemo />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

export default Hero;
