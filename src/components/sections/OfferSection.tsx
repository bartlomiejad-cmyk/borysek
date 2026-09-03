import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Reveal } from "@/components/ui-custom/Reveal";
import { offerPackages } from "@/data/content";
import { PricingCard } from "./PricingCard";

/** Na mobile pakiet Sklep jest pierwszy; od md wracamy do kolejności z danych. */
const mobileOrderClass: Record<number, string> = {
  1: "order-1 md:order-none",
  2: "order-2 md:order-none",
  3: "order-3 md:order-none",
};

export function OfferSection() {
  return (
    <section id="offer" className="relative lp-section">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Oferta"
            title="Płacisz za gotowe karty, nie za godziny."
            lead="Cena zależy od liczby produktów i zakresu. Każdy pakiet zawiera weryfikację przez człowieka i publikację."
            align="center"
          />
        </Reveal>

        <div className="lp-section-body grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3">
          {offerPackages.map((pkg, i) => (
            <Reveal key={pkg.id} index={i} className={`h-full ${mobileOrderClass[pkg.mobileOrder]}`}>
              <PricingCard pkg={pkg} />
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p
            className="lp-body mx-auto mt-12 max-w-xl text-center"
            style={{ color: "var(--text-muted)" }}
          >
            Cenę podajemy po bezpłatnej próbce, gdy znamy Twój asortyment. Próbka nie zobowiązuje
            do zamówienia.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

export default OfferSection;
