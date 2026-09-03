import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { contactEmail, contactPhone, isSet } from "@/data/content";
import { SHOW_CASE_STUDIES } from "@/data/case-studies";

type FooterColumn = { heading: string; links: { label: string; href: string }[] };

const columns: FooterColumn[] = [
  {
    heading: "Usługa",
    links: [
      ...(SHOW_CASE_STUDIES ? [{ label: "Realizacje", href: "#cases" }] : []),
      { label: "Przed i po", href: "#before-after" },
      { label: "Oferta", href: "#offer" },
    ],
  },
  {
    heading: "Kontakt",
    links: [
      ...(isSet(contactEmail) ? [{ label: contactEmail, href: `mailto:${contactEmail}` }] : []),
      ...(isSet(contactPhone) ? [{ label: contactPhone, href: `tel:${contactPhone}` }] : []),
      { label: "LinkedIn", href: "#" },
    ],
  },
  {
    heading: "Prawne",
    links: [
      { label: "Regulamin", href: "#" },
      { label: "Polityka prywatności", href: "#" },
    ],
  },
];

/** Pokazuje przycisk dopiero po przewinięciu poniżej sekcji hero. */
function useScrolledPastHero() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = () => {
      const hero = document.querySelector<HTMLElement>("[data-hero]");
      const threshold = hero?.offsetHeight ?? window.innerHeight;
      setVisible(window.scrollY > threshold);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return visible;
}

export function SiteFooter() {
  const showTop = useScrolledPastHero();

  return (
    <footer
      className="relative"
      style={{
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--glass-border)",
        paddingTop: 56,
        paddingBottom: 56,
      }}
    >
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          <div className="flex max-w-sm flex-col gap-3">
            <span className="flex items-center gap-2.5">
              <span
                className="h-5 w-5 rounded-[7px]"
                style={{ background: "var(--accent)", boxShadow: "0 0 16px var(--accent-glow)" }}
              />
              <span
                className="text-[0.9375rem]"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.02em",
                }}
              >
                AI Product Platform
              </span>
            </span>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
            >
              Kompletne karty produktowe dla sklepów, które mają więcej produktów niż czasu.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:gap-16">
            {columns.map((col) => (
              <div key={col.heading} className="flex flex-col gap-3">
                <span className="lp-caption" style={{ color: "var(--text-muted)" }}>
                  {col.heading}
                </span>
                {col.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    className="text-sm transition-colors hover:text-[var(--text-primary)] motion-reduce:transition-none"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div
          className="flex flex-col gap-3 pt-8 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderTop: "1px solid var(--glass-border)" }}
        >
          <p className="lp-caption" style={{ color: "var(--text-muted)" }}>
            © 2026 AI Product Platform. Wszystkie prawa zastrzeżone.
          </p>
          <p className="lp-caption" style={{ color: "var(--text-muted)" }}>
            Dane przetwarzamy zgodnie z RODO.
          </p>
        </div>
      </Container>

      <button
        type="button"
        aria-label="Do góry"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        tabIndex={showTop ? 0 : -1}
        aria-hidden={!showTop}
        className={`lp-glass fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center border transition-opacity duration-300 motion-reduce:transition-none md:bottom-6 md:right-6 ${
          showTop ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{
          borderRadius: 9999,
          borderColor: "var(--glass-border-strong)",
          background: "var(--glass-bg-strong)",
          color: "var(--text-primary)",
        }}
      >
        <ArrowUp aria-hidden className="h-5 w-5" />
      </button>
    </footer>
  );
}

export default SiteFooter;
