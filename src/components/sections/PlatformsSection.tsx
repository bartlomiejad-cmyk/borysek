import { Store } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Pill } from "@/components/ui-custom/Pill";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { Reveal } from "@/components/ui-custom/Reveal";
import { platforms } from "@/data/content";

export function PlatformsSection() {
  return (
    <section id="platforms" className="relative py-20 md:py-32">
      <Container>
        <Reveal>
        <SectionHeading
          eyebrow="Platformy"
          title="Pracujemy z Twoim sklepem, jaki jest."
          lead="Publikujemy przez import w panelu Twojego sklepu albo oddajemy plik gotowy do wgrania. Bez integracji, bez wtyczek."
          align="left"
          className="mb-16"
        />
        </Reveal>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {platforms.map((platform, i) => {
            const isUpload = platform.mode === "upload";
            return (
              <Reveal key={platform.name} index={i}>
              <GlassCard
                blur={false}
                padding="md"
                className="flex h-full flex-col items-center gap-4 text-center"
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{
                    background: "var(--glass-bg-strong)",
                    border: "1px solid var(--glass-border)",
                  }}
                >
                  <Store aria-hidden className="h-5 w-5" style={{ color: "var(--text-secondary)" }} />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span
                    className="text-base"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    {platform.name}
                  </span>
                  <Pill variant="neutral">
                    {isUpload ? "Wgrywamy za Ciebie" : "Plik CSV lub XLSX"}
                  </Pill>
                </div>
              </GlassCard>
              </Reveal>
            );
          })}
        </div>

        <p
          className="mx-auto mt-12 max-w-xl text-center lp-body"
          style={{ color: "var(--text-secondary)" }}
        >
          Inna platforma? Wystarczy eksport produktów z Twojego sklepu. Oddajemy plik w Twoim
          oryginalnym układzie kolumn, gotowy do importu bez przeklejania.
        </p>
      </Container>
    </section>
  );
}
