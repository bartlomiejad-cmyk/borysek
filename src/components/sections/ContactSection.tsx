import { Check } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { Reveal } from "@/components/ui-custom/Reveal";
import { SampleForm } from "./SampleForm";

const benefits = ["Bez zobowiązań", "Do 2 dni roboczych", "Gotowe do publikacji"];

export function ContactSection() {
  return (
    <section id="contact" className="scroll-mt-24 py-20 md:py-28">
      <Container>
        <Reveal>
        <GlassCard
          variant="strong"
          padding="none"
          className="relative overflow-hidden"
          style={{ borderRadius: 32 }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(270deg, var(--accent-soft) 0%, rgba(0,0,0,0) 70%)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
            style={{ background: "var(--accent-glow)", filter: "blur(90px)" }}
          />

          <div className="relative grid grid-cols-1 gap-10 p-7 md:grid-cols-2 md:gap-14 md:p-14">
            <div className="flex flex-col gap-4">
              <span className="lp-caption" style={{ color: "var(--accent)" }}>
                Bezpłatna próbka
              </span>
              <h2 className="lp-h2" style={{ color: "var(--text-primary)" }}>
                Wybierzemy 5 Twoich produktów i przygotujemy gotowe karty.
              </h2>
              <p className="lp-lead" style={{ color: "var(--text-secondary)" }}>
                Zobaczysz efekt na własnym asortymencie, zanim cokolwiek zamówisz. Odpowiadamy w
                ciągu jednego dnia roboczego.
              </p>
              <ul className="mt-2 flex flex-col gap-3">
                {benefits.map((b) => (
                  <li
                    key={b}
                    className="flex items-center gap-3 text-[0.9375rem]"
                    style={{ color: "var(--text-primary)", fontFamily: "var(--font-body)" }}
                  >
                    <span
                      aria-hidden
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--accent-soft)" }}
                    >
                      <Check
                        className="h-3 w-3"
                        strokeWidth={3}
                        style={{ color: "var(--accent)" }}
                      />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            <SampleForm />
          </div>
        </GlassCard>
        </Reveal>
      </Container>
    </section>
  );
}

export default ContactSection;
