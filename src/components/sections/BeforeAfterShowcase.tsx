import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Ruler, Send } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Pill } from "@/components/ui-custom/Pill";
import { showcaseProducts } from "@/data/demo-products";
import { StateToggle, type ShowcaseState } from "./StateToggle";
import { ShowcaseCard } from "./ShowcaseCard";

const AFTER_PILLS = [
  { icon: Plus, text: "+6 pól uzupełnionych" },
  { icon: Ruler, text: "Tytuł SEO w limicie 60 znaków" },
  { icon: Send, text: "Opis opublikowany w sklepie" },
];

export function BeforeAfterShowcase() {
  const [state, setState] = useState<ShowcaseState>("after");

  return (
    <section id="before-after" className="relative py-24 md:py-32">
      <Container>
        <SectionHeading
          align="center"
          eyebrow="Przed i po"
          title="Ta sama karta. Po jednym przebiegu u nas."
          lead="Przełącz widok, żeby zobaczyć, co dokładnie dostajesz."
        />

        <div className="mt-10 flex justify-center">
          <StateToggle value={state} onChange={setState} />
        </div>

        <div className="mt-12 -mx-6 flex snap-x snap-mandatory gap-6 overflow-x-auto px-6 pb-4 md:mx-0 md:grid md:grid-cols-2 md:justify-items-center md:overflow-visible md:px-0 lg:grid-cols-3">
          {showcaseProducts.map((product) => (
            <ShowcaseCard key={product.id} product={product} state={state} />
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {state === "after" ? (
            AFTER_PILLS.map(({ icon: Icon, text }) => (
              <motion.span
                key={text}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Pill variant="accent" icon={Icon}>
                  {text}
                </Pill>
              </motion.span>
            ))
          ) : (
            <Pill variant="neutral">Karta niekompletna: 3 z 8 pól</Pill>
          )}
        </div>
      </Container>
    </section>
  );
}

export default BeforeAfterShowcase;
