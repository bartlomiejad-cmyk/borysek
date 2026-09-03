import { Check } from "lucide-react";
import { AccentButton, GhostButton } from "@/components/ui-custom/Buttons";
import type { OfferPackage } from "@/data/content";

const topGradient: Record<OfferPackage["variant"], string> = {
  start: "linear-gradient(180deg, #2A3340 0%, #1B2028 100%)",
  shop: "linear-gradient(180deg, var(--accent) 0%, #0A6B50 100%)",
  catalog: "linear-gradient(180deg, #1F2328 0%, #121519 100%)",
};

function scrollToContact() {
  document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
}

function CardHeader({ pkg }: { pkg: OfferPackage }) {
  const onAccent = pkg.variant === "shop";
  const secondary = onAccent ? "rgba(4,17,12,0.7)" : "var(--text-secondary)";

  return (
    <div
      className="relative flex h-[180px] flex-col items-center justify-center gap-2 px-6 text-center"
      style={{
        background: topGradient[pkg.variant],
        borderRadius: "var(--radius-card) var(--radius-card) 0 0",
      }}
    >
      {pkg.featured ? (
        <span
          className="absolute right-[14px] top-[14px] whitespace-nowrap px-3 py-1 text-[0.8125rem] font-medium"
          style={{
            background: "rgba(7,8,9,0.28)",
            color: "var(--accent-ink)",
            borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-body)",
          }}
        >
          Najczęściej wybierany
        </span>
      ) : null}

      <span className="lp-caption" style={{ color: secondary }}>
        {pkg.caption}
      </span>
      <h3
        className="text-2xl font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          color: onAccent ? "var(--accent-ink)" : "var(--text-primary)",
        }}
      >
        {pkg.name}
      </h3>

      {pkg.price === null ? (
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "1.5rem",
            color: onAccent ? "var(--accent-ink)" : "var(--text-primary)",
          }}
        >
          {pkg.priceNote}
        </span>
      ) : (
        <div className="flex items-baseline gap-2">
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "2.5rem",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              color: onAccent ? "var(--accent-ink)" : "var(--text-primary)",
            }}
          >
            {pkg.price}
          </span>
          <span className="lp-body" style={{ color: secondary }}>
            {pkg.priceLabel}
          </span>
        </div>
      )}
    </div>
  );
}

export function PricingCard({ pkg }: { pkg: OfferPackage }) {
  const Cta = pkg.featured ? AccentButton : GhostButton;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{
        borderRadius: "var(--radius-card)",
        border: pkg.featured
          ? "1.5px solid var(--accent)"
          : "1px solid var(--glass-border-strong)",
        boxShadow: pkg.featured ? "0 0 40px var(--accent-glow)" : undefined,
      }}
    >
      <CardHeader pkg={pkg} />

      <div
        className="flex flex-1 flex-col gap-6 px-6 pb-8 pt-8"
        style={{ background: "var(--glass-bg)", borderTop: "1px solid var(--glass-border)" }}
      >
        <ul className="flex flex-col gap-3">
          {pkg.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3">
              <span
                aria-hidden
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
          <Cta
            size="lg"
            className="w-full"
            aria-label={`${pkg.cta}: pakiet ${pkg.name}`}
            onClick={scrollToContact}
          >
            {pkg.cta}
          </Cta>
        </div>
      </div>
    </div>
  );
}

export default PricingCard;
