import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Ruler, Send } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Pill } from "@/components/ui-custom/Pill";
import { showcaseProducts } from "@/data/demo-products";
import { Reveal } from "@/components/ui-custom/Reveal";
import { StateToggle, type ShowcaseState } from "./StateToggle";
import { ShowcaseCard } from "./ShowcaseCard";

const AFTER_PILLS = [
  { icon: Plus, text: "+8 pól uzupełnionych" },
  { icon: Ruler, text: "Tytuł SEO w limicie 60 znaków" },
  { icon: Send, text: "Opis opublikowany w sklepie" },
];

export function BeforeAfterShowcase() {
  const [state, setState] = useState<ShowcaseState>("after");

  return (
    <section id="before-after" className="relative py-20 md:py-32">
      <Container>
        <Reveal>
        <SectionHeading
          align="center"
          eyebrow="Przed i po"
          title="Ta sama karta. Po jednym przebiegu u nas."
          lead="Przełącz widok, żeby zobaczyć, co dokładnie dostajesz."
        />
        </Reveal>

        <div className="mt-10 flex justify-center">
          <StateToggle value={state} onChange={setState} />
        </div>

        <div className="mt-12 -mx-6 flex snap-x snap-mandatory gap-6 overflow-x-auto px-6 pb-4 md:mx-0 md:grid md:grid-cols-2 md:justify-items-center md:overflow-visible md:px-0 lg:grid-cols-3">
          {showcaseProducts.map((product, i) => (
            <Reveal key={product.id} index={i} className="snap-start">
              <ShowcaseCard product={product} state={state} />
            </Reveal>
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
            <Pill variant="neutral">Karta niekompletna: 2 z 10 pól</Pill>
          )}
        </div>

        <p
          className="mx-auto mt-8 max-w-2xl text-center lp-body"
          style={{ color: "var(--text-secondary)" }}
        >
          Każdy opis powstaje z realnych, zweryfikowanych źródeł opisujących dokładnie ten
          produkt, nie z wyobraźni modelu.
        </p>
      </Container>
    </section>
  );
}

export default BeforeAfterShowcase;
