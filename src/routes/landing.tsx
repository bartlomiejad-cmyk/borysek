import { createFileRoute } from "@tanstack/react-router";
import { PageBackground } from "@/components/ui-custom/PageBackground";
import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { ResultsBar } from "@/components/landing/ResultsBar";
import { HowSection } from "@/components/landing/HowSection";
import { BeforeAfterShowcase } from "@/components/sections/BeforeAfterShowcase";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      {
        title:
          "AI Product Platform. Karty produktowe dla Twojego sklepu, gotowe i opublikowane",
      },
      {
        name: "description",
        content:
          "Dajesz nam dostęp do sklepu albo plik z produktami. Dostarczamy kompletne karty produktowe: nazwy, opisy, cechy, kategorie i SEO, sprawdzone przez ludzi i opublikowane w Twoim sklepie.",
      },
      {
        property: "og:title",
        content:
          "AI Product Platform. Karty produktowe dla Twojego sklepu, gotowe i opublikowane",
      },
      {
        property: "og:description",
        content:
          "Usługa uzupełniania kart produktowych dla sklepów internetowych: AI plus weryfikacja zespołu, publikacja przez API lub plik.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <main className="lp-surface relative min-h-screen">
      <PageBackground />
      <Navbar />
      <Hero />
      <ResultsBar />
      <div id="cases" />
      <HowSection />
      <BeforeAfterShowcase />
    </main>
  );
}
