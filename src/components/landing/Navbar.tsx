import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { AccentButton } from "@/components/ui-custom/Buttons";
import { navLinks } from "@/data/demo-products";
import { SHOW_CASE_STUDIES } from "@/data/case-studies";

const visibleLinks = navLinks.filter((l) => SHOW_CASE_STUDIES || l.href !== "#cases");

const scrollTo = (id: string) =>
  document.querySelector(id)?.scrollIntoView({ behavior: "smooth" });

function BrandMark() {
  return (
    <a href="#top" className="flex items-center gap-2.5">
      <span
        className="h-5 w-5 rounded-[7px]"
        style={{ background: "var(--accent)", boxShadow: "0 0 16px var(--accent-glow)" }}
      />
      <span
        className="text-[0.9375rem]"
        style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" }}
      >
        AI Product Platform
      </span>
    </a>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header
      className="lp-glass sticky top-0 z-50"
      style={{
        height: 72,
        background: "var(--glass-bg)",
        borderBottom: "1px solid var(--glass-border)",
      }}
    >
      <Container className="flex h-[72px] items-center justify-between gap-6">
        <BrandMark />

        <nav className="hidden items-center gap-7 lg:flex">
          {visibleLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm transition-colors hover:text-[var(--text-primary)] motion-reduce:transition-none"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <AccentButton size="md" onClick={() => scrollTo("#contact")}>
            Bezpłatna próbka
          </AccentButton>
        </div>

        <button
          type="button"
          aria-label={open ? "Zamknij menu" : "Otwórz menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center border lg:hidden"

          style={{
            borderRadius: "var(--radius-button)",
            borderColor: "var(--glass-border-strong)",
            color: "var(--text-primary)",
          }}
        >
          {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
        </button>
      </Container>

      {open ? (
        <div
          id="mobile-menu"
          className="lp-glass fixed inset-0 z-50 flex flex-col lg:hidden"
          style={{ background: "rgba(7,8,9,0.92)" }}
        >

          <div className="flex h-[72px] items-center justify-between px-6">
            <BrandMark />
            <button
              type="button"
              aria-label="Zamknij menu"
              onClick={() => setOpen(false)}
              className="flex h-11 w-11 items-center justify-center border"
              style={{
                borderRadius: "var(--radius-button)",
                borderColor: "var(--glass-border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-2 px-6 pt-6">
            {visibleLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border px-5 py-4 text-lg"
                style={{
                  borderRadius: "var(--radius-card)",
                  borderColor: "var(--glass-border)",
                  background: "var(--glass-bg)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-body)",
                }}
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex flex-col gap-3 px-6 pb-10">
            <AccentButton
              size="lg"
              className="w-full"
              onClick={() => {
                setOpen(false);
                scrollTo("#contact");
              }}
            >
              Bezpłatna próbka
            </AccentButton>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export default Navbar;
