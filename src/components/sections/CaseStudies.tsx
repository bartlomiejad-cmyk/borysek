import { motion } from "framer-motion";
import { useState } from "react";
import { AccentButton, GhostButton } from "@/components/ui-custom/Buttons";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { caseStudies } from "@/data/case-studies";
import { CaseStudyCard } from "./CaseStudyCard";

const VISIBLE_COUNT = 3;

export function CaseStudies() {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? caseStudies : caseStudies.slice(0, VISIBLE_COUNT);

  return (
    <section id="cases" className="py-20 md:py-28">
      <Container>
        <SectionHeading
          eyebrow="Realizacje"
          title="Co zrobiliśmy u innych sklepów."
          lead="Każda realizacja to prawdziwy sklep, prawdziwe produkty i prawdziwe liczby. Nazwy klientów podajemy za ich zgodą."
        />

        <div className="mt-14 flex flex-col gap-8">
          {visible.map((study, i) => (
            <motion.div
              key={study.id}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: "easeOut" }}
            >
              <CaseStudyCard study={study} defaultOpen={i === 0} />
            </motion.div>
          ))}
        </div>

        {!showAll && caseStudies.length > VISIBLE_COUNT ? (
          <div className="mt-10 flex justify-center">
            <GhostButton onClick={() => setShowAll(true)}>Więcej realizacji</GhostButton>
          </div>
        ) : null}

        <div className="mt-16 flex flex-col items-center gap-5 text-center">
          <p className="lp-lead" style={{ color: "var(--text-secondary)" }}>
            Chcesz zobaczyć, jak wyglądałyby Twoje produkty?
          </p>
          <AccentButton
            size="lg"
            onClick={() =>
              document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            Bezpłatna próbka: 5 produktów
          </AccentButton>
        </div>
      </Container>
    </section>
  );
}

export default CaseStudies;
