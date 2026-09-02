import { Container } from "@/components/ui-custom/Container";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { StatCounter } from "./StatCounter";
import { landingStats } from "@/data/stats";

export function ResultsBar() {
  return (
    <section className="pb-4">
      <Container>
        <GlassCard padding="lg">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {landingStats.map((stat) => (
              <div key={stat.text}>
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
      </Container>
    </section>
  );
}

export default ResultsBar;
