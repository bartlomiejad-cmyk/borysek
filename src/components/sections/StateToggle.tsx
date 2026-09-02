import { motion } from "framer-motion";

export type ShowcaseState = "before" | "after";

const OPTIONS: { value: ShowcaseState; label: string }[] = [
  { value: "before", label: "Przed" },
  { value: "after", label: "Po" },
];

export function StateToggle({
  value,
  onChange,
}: {
  value: ShowcaseState;
  onChange: (next: ShowcaseState) => void;
}) {
  const move = (dir: -1 | 1) => {
    const i = OPTIONS.findIndex((o) => o.value === value);
    const next = OPTIONS[(i + dir + OPTIONS.length) % OPTIONS.length]!;
    onChange(next.value);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="tablist"
        aria-label="Porównanie karty produktu"
        className="lp-glass flex items-center gap-1 rounded-full p-1"
        style={{
          background: "var(--glass-bg)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-highlight)",
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            move(-1);
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            move(1);
          }
        }}
      >
        {OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(option.value)}
              className="relative rounded-full px-6 py-2 text-[14px] font-medium transition-colors"
              style={{
                color: active ? "var(--accent-ink)" : "var(--text-secondary)",
                fontFamily: "var(--font-body)",
              }}
            >
              {active ? (
                <motion.span
                  layoutId="before-after-toggle"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              ) : null}
              <span className="relative">{option.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        Kliknij, aby porównać
      </p>
    </div>
  );
}

export default StateToggle;
