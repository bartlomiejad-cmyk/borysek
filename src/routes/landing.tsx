import { createFileRoute } from "@tanstack/react-router";
import { PageBackground } from "@/components/ui-custom/PageBackground";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "AI Product Platform — dane produktowe generowane przez AI" },
      {
        name: "description",
        content:
          "AI tworzy komplet danych produktowych: nazwę, opis, cechy, kategorię i SEO — i wysyła je do Twojego sklepu przez API jednym kliknięciem.",
      },
      { property: "og:title", content: "AI Product Platform" },
      {
        property: "og:description",
        content:
          "Kompletne dane produktowe dla e-commerce generowane przez AI i wysyłane do sklepu przez API.",
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
    </main>
  );
}
