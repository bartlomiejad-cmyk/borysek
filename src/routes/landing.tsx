import { createFileRoute } from "@tanstack/react-router";
import { PageBackground } from "@/components/ui-custom/PageBackground";
import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { ResultsBar } from "@/components/landing/ResultsBar";
import { HowSection } from "@/components/landing/HowSection";
import { ProcessFlow } from "@/components/sections/ProcessFlow";
import { BeforeAfterShowcase } from "@/components/sections/BeforeAfterShowcase";
import { CaseStudies } from "@/components/sections/CaseStudies";
import { SHOW_CASE_STUDIES } from "@/data/case-studies";
import { OfferSection } from "@/components/sections/OfferSection";
import { PlatformsSection } from "@/components/sections/PlatformsSection";
import { ContactSection } from "@/components/sections/ContactSection";
import { SiteFooter } from "@/components/landing/SiteFooter";

const TITLE =
  "AI Product Platform. Karty produktowe dla Twojego sklepu, gotowe i opublikowane";
const DESCRIPTION =
  "Dajesz nam dostęp do sklepu albo plik z produktami. Oddajemy gotowe nazwy, opisy, cechy, SEO i zdjęcia, sprawdzone przez ludzi.";
const URL = "https://borysek.lovable.app/landing";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: URL },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Service",
          name: "AI Product Platform",
          serviceType: "Uzupełnianie kart produktowych dla sklepów internetowych",
          description: DESCRIPTION,
          areaServed: { "@type": "Country", name: "Polska" },
          url: URL,
          provider: { "@type": "Organization", name: "AI Product Platform", url: URL },
        }),
      },
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
      {SHOW_CASE_STUDIES ? <CaseStudies /> : null}
      <HowSection />
      <BeforeAfterShowcase />
      <ProcessFlow />
      <OfferSection />
      <PlatformsSection />

      <ContactSection />
      <SiteFooter />
    </main>
  );
}
