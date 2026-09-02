import { Check } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { AccentButton, GhostButton } from "@/components/ui-custom/Buttons";
import { Pill } from "@/components/ui-custom/Pill";
import { cn } from "@/lib/utils";

type Package = {
  id: string;
  name: string;
  caption: string;
  price: string | null;
  priceLabel: string | null;
  features: string[];
  cta: string;
  variant: "start" | "shop" | "catalog";
  featured?: boolean;
};

const packages: Package[] = [
  {
    id: "start",
    name: "Start",
    caption: "do 100 produktów",
    price: "[CENA] zł",
    priceLabel: "za produkt",
    features: [
      "nazwa, opis, cechy, kategoria",
      "tytuł i opis SEO",
      "weryfikacja przez redaktora",
      "publikacja przez API lub plik",
    ],
    cta: "Zamów próbkę",
    variant: "start",
  },
  {
    id: "shop",
    name: "Sklep",
    caption: "100 do 1 000 produktów",
    price: "[CENA] zł",
    priceLabel: "za produkt",
    features: [
      "wszystko z pakietu Start",
      "ton marki i słownik branżowy",
      "warianty produktów",
      "drugi język w cenie",
    ],
    cta: "Zamów próbkę",
    variant: "shop",
    featured: true,
  },
  {
    id: "catalog",
    name: "Katalog",
    caption: "ponad 1 000 produktów",
    price: null,
    priceLabel: null,
    features: [
      "wszystko z pakietu Sklep",
      "harmonogram partiami",
      "zdjęcia lifestyle",
      "stała opieka nad nowościami",
    ],
    cta: "Umów rozmowę",
    variant: "catalog",
  },
];

const topGradient: Record<Package["variant"], string> = {
  start: "linear-gradient(180deg, #2A3340 0%, #1B2028 100%)",
  shop: "linear-gradient(180deg, var(--accent) 0%, #0A6B50 100%)",
  catalog: "linear-gradient(180deg, #1F2328 0%, #121519 100%)",
};

function PricingCard({ pkg }: { pkg: Package }) {
  const isCatalog = pkg.variant === "catalog";

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden",
        pkg.featured ? "lg:scale-[1.03]" : ""
      )}
      style={{
        borderRadius: "var(--radius-card)",
        border: pkg.variant === "catalog" ? "1px solid var(--glass-border-strong)" : undefined,
        boxShadow: pkg.featured ? "0 0 40px rgba(0, 188, 135, 0.12)" : undefined,
      }}
    >
      {pkg.featured ? (
        <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
          <Pill variant="accent">Najczęściej wybierany</Pill>
        </div>
      ) : null}

      <div
        className="flex flex-col items-center gap-3 px-6 pb-8 pt-10 text-center"
        style={{ background: topGradient[pkg.variant] }}
      >
        <span
          className="lp-caption"
          style={{ color: pkg.variant === "shop" ? "rgba(4,17,12,0.7)" : "var(--text-secondary)" }}
        >
          {pkg.caption}
        </span>
        <h3
          className="text-2xl font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: pkg.variant === "shop" ? "var(--accent-ink)" : "var(--text-primary)",
          }}
        >
          {pkg.name}
        </h3>

        {isCatalog ? (
          <span
            className="mt-2"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "1.5rem",
              color: "var(--text-primary)",
            }}
          >
            Wycena indywidualna
          </span>
        ) : (
          <div className="mt-2 flex items-baseline gap-2">
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "2.5rem",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                color: pkg.variant === "shop" ? "var(--accent-ink)" : "var(--text-primary)",
              }}
            >
              {pkg.price}
            </span>
            <span
              className="lp-body"
              style={{ color: pkg.variant === "shop" ? "rgba(4,17,12,0.7)" : "var(--text-secondary)" }}
            >
              {pkg.priceLabel}
            </span>
          </div>
        )}
      </div>

      <div
        className="flex flex-1 flex-col gap-6 px-6 pb-8 pt-8"
        style={{
          background: "var(--glass-bg)",
          borderTop: "1px solid var(--glass-border)",
        }}
      >
        <ul className="flex flex-col gap-3">
          {pkg.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--accent-soft)" }}
              >
                <Check className="h-3 w-3" style={{ color: "var(--accent)" }} strokeWidth={3} />
              </span>
              <span className="lp-body" style={{ color: "var(--text-secondary)" }}>
                {feature}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-auto">
          {pkg.featured ? (
            <AccentButton
              size="lg"
              className="w-full"
              onClick={() => scrollToContact()}
            >
              {pkg.cta}
            </AccentButton>
          ) : (
            <GhostButton
              size="lg"
              className="w-full"
              onClick={() => scrollToContact()}
            >
              {pkg.cta}
            </GhostButton>
          )}
        </div>
      </div>
    </div>
  );
}

function scrollToContact() {
  const el = document.getElementById("contact");
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

export function OfferSection() {
  return (
    <section id="offer" className="relative py-24 lg:py-32">
      <Container>
        <SectionHeading
          eyebrow="Oferta"
          title="Płacisz za gotowe karty, nie za godziny."
          lead="Cena zależy od liczby produktów i zakresu. Każdy pakiet zawiera weryfikację przez człowieka i publikację."
          align="center"
          className="mb-16"
        />

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 lg:items-start">
          {packages.map((pkg) => (
            <PricingCard key={pkg.id} pkg={pkg} />
          ))}
        </div>

        <p
          className="mx-auto mt-12 max-w-xl text-center lp-body"
          style={{ color: "var(--text-muted)" }}
        >
          Próbka 5 produktów jest bezpłatna i nie zobowiązuje do zamówienia.
        </p>
      </Container>
    </section>
  );
}
