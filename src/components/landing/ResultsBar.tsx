import { Container } from "@/components/ui-custom/Container";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { Reveal } from "@/components/ui-custom/Reveal";
import { ConfettiLayer } from "./ConfettiLayer";
import { StatCounter } from "./StatCounter";
import { landingStats } from "@/data/stats";

export function ResultsBar() {
  return (
    <section className="relative overflow-hidden pb-4">
      <ConfettiLayer seed={11} />
      <div className="relative" style={{ zIndex: 1 }}>
      <Container>
        <h2 className="sr-only">Jak to działa w liczbach</h2>
        <Reveal>
        <GlassCard padding="lg">
          <div className="grid grid-cols-2 items-start gap-8 md:grid-cols-4">
            {landingStats.map((stat) => (
              <div key={stat.text} className="flex h-full flex-col items-start">
                <StatCounter
                  value={stat.value}
                  suffix={stat.suffix}
                  size="clamp(2rem, 3.5vw, 2.75rem)"
                />
                <p className="mt-3 lp-body" style={{ color: "var(--text-secondary)" }}>
                  {stat.text}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
        </Reveal>
      </Container>
      </div>
    </section>
  );
}

export default ResultsBar;
