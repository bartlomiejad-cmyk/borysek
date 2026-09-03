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
    <section id="top" data-hero className="relative pt-16 pb-16 md:pt-24">
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
                style={{
                  color: "var(--text-primary)",
                  textWrap: "balance",
                  fontSize: "clamp(2.25rem, 5vw, 4rem)",
                }}
              >
                Kompletne karty produktowe dla Twojego sklepu.
              </h1>
            </Reveal>

            <Reveal index={2}>
              <p className="lp-lead max-w-xl" style={{ color: "var(--text-secondary)" }}>
                Setki produktów w dni zamiast miesięcy. Dajesz nam eksport ze sklepu albo plik
                z produktami, dostajesz gotowe nazwy, opisy, cechy, treści SEO i zdjęcia,
                sprawdzone przez ludzi i wgrane do sklepu.
              </p>
            </Reveal>

            <Reveal index={3} className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <AccentButton size="lg" className="w-full sm:w-auto" onClick={() => scrollTo("#contact")}>
                Bezpłatna próbka: 5 produktów
              </AccentButton>
              <GhostButton
                size="lg"
                className="w-full sm:w-auto"
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
