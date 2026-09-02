import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, ShieldCheck, Zap } from "lucide-react";
import { PageBackground } from "@/components/ui-custom/PageBackground";
import { Container } from "@/components/ui-custom/Container";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { Pill } from "@/components/ui-custom/Pill";
import { AccentButton, GhostButton } from "@/components/ui-custom/Buttons";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";

export const Route = createFileRoute("/styleguide")({
  head: () => ({
    meta: [
      { title: "Styleguide — AI Product Platform" },
      { name: "description", content: "Podgląd systemu designu: kolory, typografia i komponenty." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Styleguide — AI Product Platform" },
      { property: "og:description", content: "Podgląd systemu designu landing page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StyleguidePage,
});

const colors = [
  ["--bg-base", "Tło bazowe"],
  ["--bg-surface", "Powierzchnia"],
  ["--bg-elevated", "Wyniesiona"],
  ["--accent", "Akcent"],
  ["--accent-hover", "Akcent hover"],
  ["--amber", "Człowiek w pętli"],
  ["--danger", "Błąd"],
  ["--text-primary", "Tekst główny"],
  ["--text-secondary", "Tekst dodatkowy"],
  ["--text-muted", "Tekst wygaszony"],
];

function StyleguidePage() {
  return (
    <main className="lp-surface relative min-h-screen py-20">
      <PageBackground />
      <Container className="flex flex-col gap-20">
        <SectionHeading
          eyebrow="System designu"
          title="Fundament wizualny AI Product Platform"
          lead="Zestaw tokenów i komponentów używanych na stronie: ciemne tło, szkło, jeden kolor akcentu."
        />

        <section className="flex flex-col gap-6">
          <h3 className="lp-h3" style={{ color: "var(--text-primary)" }}>Typografia</h3>
          <div className="flex flex-col gap-4">
            <span className="lp-caption" style={{ color: "var(--accent)" }}>Caption / eyebrow</span>
            <p className="lp-h1" style={{ color: "var(--text-primary)" }}>Nagłówek H1</p>
            <p className="lp-h2" style={{ color: "var(--text-primary)" }}>Nagłówek H2</p>
            <p className="lp-h3" style={{ color: "var(--text-primary)" }}>Nagłówek H3</p>
            <p className="lp-lead" style={{ color: "var(--text-secondary)" }}>
              Lead: AI przygotowuje komplet danych produktowych i wysyła je do sklepu przez API.
            </p>
            <p className="lp-body" style={{ color: "var(--text-secondary)" }}>
              Body: opis, cechy, kategoria oraz tytuł i opis SEO powstają na podstawie surowych danych lub adresu URL.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <h3 className="lp-h3" style={{ color: "var(--text-primary)" }}>Kolory</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {colors.map(([token, label]) => (
              <GlassCard key={token} padding="sm" className="flex flex-col gap-3">
                <div
                  className="h-16 w-full rounded-2xl border"
                  style={{ background: `var(${token})`, borderColor: "var(--glass-border)" }}
                />
                <div className="flex flex-col">
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{token}</span>
                </div>
              </GlassCard>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <h3 className="lp-h3" style={{ color: "var(--text-primary)" }}>Przyciski</h3>
          <div className="flex flex-wrap items-center gap-4">
            <AccentButton size="md">Bezpłatna próbka</AccentButton>
            <AccentButton size="lg">Bezpłatna próbka</AccentButton>
            <GhostButton size="md">Zobacz demo</GhostButton>
            <GhostButton size="lg">Zobacz demo</GhostButton>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <h3 className="lp-h3" style={{ color: "var(--text-primary)" }}>Pigułki</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Pill variant="accent" icon={Sparkles}>AI Complete</Pill>
            <Pill variant="amber" icon={ShieldCheck}>Weryfikacja człowieka</Pill>
            <Pill variant="neutral" icon={Zap}>Automation</Pill>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <h3 className="lp-h3" style={{ color: "var(--text-primary)" }}>Karty szklane</h3>
          <div className="grid gap-6 md:grid-cols-2">
            <GlassCard padding="lg">
              <h4 className="lp-h3" style={{ color: "var(--text-primary)" }}>GlassCard — default</h4>
              <p className="lp-body mt-3" style={{ color: "var(--text-secondary)" }}>
                Półprzezroczyste tło, cienkie obramowanie i miękki cień.
              </p>
            </GlassCard>
            <GlassCard variant="strong" radius="lg" padding="lg">
              <h4 className="lp-h3" style={{ color: "var(--text-primary)" }}>GlassCard — strong</h4>
              <p className="lp-body mt-3" style={{ color: "var(--text-secondary)" }}>
                Mocniejsze szkło i jaśniejsze obramowanie dla kluczowych kafli.
              </p>
            </GlassCard>
          </div>
        </section>

        <section className="flex flex-col gap-10">
          <SectionHeading
            eyebrow="Wyrównanie do lewej"
            title="Nagłówek sekcji wyrównany do lewej"
            lead="Wariant domyślny, używany w większości sekcji strony."
          />
          <SectionHeading
            align="center"
            eyebrow="Wyrównanie centralne"
            title="Nagłówek sekcji wyśrodkowany"
            lead="Wariant dla sekcji otwierających i podsumowujących."
          />
        </section>
      </Container>
    </main>
  );
}
