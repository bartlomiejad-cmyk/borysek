import { Check } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/ui-custom/Container";
import { Reveal } from "@/components/ui-custom/Reveal";
import { faqItems } from "@/data/content";
import { SampleForm } from "./SampleForm";

const benefits = ["Bez zobowiązań", "Do 2 dni roboczych", "Gotowe do publikacji"];

function Benefits() {
  return (
    <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
      {benefits.map((b) => (
        <li
          key={b}
          className="flex items-center gap-2 text-[13px]"
          style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
        >
          <Check
            aria-hidden
            className="h-3.5 w-3.5 shrink-0"
            strokeWidth={3}
            style={{ color: "var(--accent)" }}
          />
          {b}
        </li>
      ))}
    </ul>
  );
}

function Faq() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="lp-caption" style={{ color: "var(--accent)" }}>
          FAQ
        </span>
        <h2 className="lp-h2" style={{ color: "var(--text-primary)" }}>
          Najczęstsze pytania
        </h2>
      </div>

      <Accordion type="single" collapsible className="w-full">
        {faqItems.map((item, i) => (
          <AccordionItem
            key={item.id}
            value={item.id}
            className="border-b-0"
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--glass-border)" }}
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
    </div>
  );
}

export function ContactSection() {
  return (
    <section id="contact" className="lp-section">
      <span id="faq" aria-hidden className="block" style={{ scrollMarginTop: 88 }} />
      <Container>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[55fr_45fr] lg:gap-14">
          <Reveal className="order-2 lg:order-1">
            <Faq />
          </Reveal>

          <Reveal index={1} className="order-1 lg:order-2">
            <div className="lg:sticky lg:top-24">
              <div className="flex flex-col gap-2">
                <span className="lp-caption" style={{ color: "var(--accent)" }}>
                  Bezpłatna próbka
                </span>
                <h3 className="lp-h3" style={{ color: "var(--text-primary)" }}>
                  5 Twoich produktów, gotowe karty, bez zobowiązań
                </h3>
              </div>
              <div className="mt-5">
                <SampleForm footer={<Benefits />} />
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

export default ContactSection;
