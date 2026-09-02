import { Store } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Pill } from "@/components/ui-custom/Pill";
import { GlassCard } from "@/components/ui-custom/GlassCard";

type Platform = {
  name: string;
  mode: "api" | "file";
};

const platforms: Platform[] = [
  { name: "Selly", mode: "api" },
  { name: "Shoper", mode: "file" },
  { name: "WooCommerce", mode: "file" },
  { name: "BaseLinker", mode: "file" },
  { name: "PrestaShop", mode: "file" },
  { name: "Shopify", mode: "file" },
];

export function PlatformsSection() {
  return (
    <section id="platforms" className="relative py-24 lg:py-32">
      <Container>
        <SectionHeading
          eyebrow="Platformy"
          title="Pracujemy z Twoim sklepem, jaki jest."
          lead="Tam, gdzie mamy integrację, publikujemy przez API. Wszędzie indziej oddajemy plik gotowy do importu."
          align="left"
          className="mb-16"
        />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {platforms.map((platform) => {
            const isApi = platform.mode === "api";
            return (
              <GlassCard
                key={platform.name}
                padding="md"
                className="flex flex-col items-center gap-4 text-center"
                style={{
                  borderColor: isApi ? "rgba(0, 188, 135, 0.5)" : undefined,
                  boxShadow: isApi
                    ? "0 0 28px rgba(0, 188, 135, 0.08), var(--glass-highlight), var(--glass-shadow)"
                    : undefined,
                }}
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{
                    background: isApi ? "var(--accent-soft)" : "var(--glass-bg-strong)",
                    border: "1px solid var(--glass-border)",
                  }}
                >
                  <Store
                    className="h-5 w-5"
                    style={{ color: isApi ? "var(--accent)" : "var(--text-secondary)" }}
                  />
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
                  <Pill variant={isApi ? "accent" : "neutral"}>
                    {isApi ? "Publikacja przez API" : "Plik CSV lub XML"}
                  </Pill>
                </div>
              </GlassCard>
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
