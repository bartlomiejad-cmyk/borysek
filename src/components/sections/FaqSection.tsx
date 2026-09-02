import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/ui-custom/Container";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Reveal } from "@/components/ui-custom/Reveal";
import { faqItems } from "@/data/content";

export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-24 py-20 md:py-28">
      <Container className="flex flex-col gap-10">
        <Reveal>
          <SectionHeading eyebrow="FAQ" title="Najczęstsze pytania" align="left" />
        </Reveal>

        <Reveal index={1}>
        <GlassCard padding="md" radius="lg" className="w-full max-w-[820px]">
          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((item, i) => (
              <AccordionItem
                key={item.id}
                value={item.id}
                className="border-b-0"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--glass-border)",
                }}
              >
                <AccordionTrigger
                  className="gap-6 py-5 text-left text-base hover:no-underline"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                  }}
                >
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="pb-5 pr-8">
                  <p
                    className="text-[0.9375rem] leading-relaxed"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
                  >
                    {item.answer}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </GlassCard>
        </Reveal>
      </Container>
    </section>
  );
}

export default FaqSection;
