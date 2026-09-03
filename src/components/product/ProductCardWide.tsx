import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, Package, type LucideIcon } from "lucide-react";
import { heroWideFields } from "@/data/demo-products";
import type { WideCellStatus } from "@/data/process-steps";

const CELL_H = 50;

export type WideCell = {
  label: string;
  value: string | null;
  status: WideCellStatus;
};

function Bars() {
  return (
    <span className="flex w-full flex-col gap-1">
      {[85, 55].map((w) => (
        <span
          key={w}
          className="block rounded-full"
          style={{ width: `${w}%`, height: 5, background: "var(--accent)", opacity: 0.85 }}
        />
      ))}
    </span>
  );
}

function Cell({ label, value, status }: WideCell) {
  const filled = status !== "empty";
  return (
    <div className="flex min-w-0 flex-col justify-center" style={{ height: CELL_H }}>
      <span
        className="truncate text-[11px] uppercase"
        style={{
          color: "var(--text-muted)",
          letterSpacing: "0.04em",
          fontFamily: "var(--font-body)",
        }}
      >
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1">
          {!filled ? (
            <span
              className="block rounded-full"
              style={{ height: 5, width: "70%", background: "rgba(255,255,255,0.10)" }}
            />
          ) : value === null ? (
            <Bars />
          ) : (
            <motion.span
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="block truncate text-[13px]"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-body)" }}
            >
              {value}
            </motion.span>
          )}
        </span>
        {status === "verified" ? (
          <span
            aria-hidden
            className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--accent)" }}
          >
            <Check className="h-[10px] w-[10px]" strokeWidth={3.5} style={{ color: "#04110C" }} />
          </span>
        ) : filled ? (
          <Check
            aria-hidden
            className="h-[14px] w-[14px] shrink-0"
            strokeWidth={3}
            style={{ color: "var(--accent)" }}
          />
        ) : (
          <span className="h-[14px] w-[14px] shrink-0" aria-hidden />
        )}
      </span>
    </div>
  );
}

export type ProductCardWideProps = {
  /** Tryb hero: liczba wypełnionych komórek (0..10). */
  filled?: number;
  /** Tryb sterowany: pełny opis komórek. */
  cells?: WideCell[];
  icon?: LucideIcon;
  showImage?: boolean;
  /** Treść pola obrazu (scena kroku). Zastępuje ikonę. */
  scene?: ReactNode;
  caption?: string;
  pill?: string;
  pillAccent?: boolean;
  accentBorder?: boolean;
};

export function ProductCardWide({
  filled = 0,
  cells,
  icon: Icon = Package,
  showImage = true,
  scene,
  caption = "GOTOWE DO SPRZEDAŻY",
  pill = "Opublikowano",
  pillAccent = true,
  accentBorder = true,
}: ProductCardWideProps) {
  const list: WideCell[] =
    cells ??
    heroWideFields.map((f, i) => ({
      label: f.label,
      value: f.value,
      status: i < filled ? ("ai" as WideCellStatus) : ("empty" as WideCellStatus),
    }));
  const total = list.length;
  const done = list.filter((c) => c.status !== "empty").length;

  return (
    <div
      className="lp-glass w-full"
      style={{
        maxWidth: 460,
        padding: 20,
        borderRadius: 24,
        background: "var(--glass-bg)",
        border: accentBorder ? "1.5px solid var(--accent)" : "1px solid var(--glass-border-strong)",
        boxShadow: "var(--glass-highlight), var(--glass-shadow)",
        transition: "border-color 300ms ease",
      }}
    >
      <div className="flex items-center justify-between gap-3" style={{ height: 28 }}>
        <span className="lp-caption truncate" style={{ color: "var(--text-secondary)" }}>
          {caption}
        </span>
        <span
          className="inline-flex shrink-0 items-center px-3 py-1 text-[0.8125rem] font-medium"
          style={{
            background: pillAccent ? "var(--accent-soft)" : "var(--glass-bg-strong)",
            color: pillAccent ? "var(--accent)" : "var(--text-secondary)",
            border: pillAccent ? "1px solid transparent" : "1px solid var(--glass-border)",
            borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-body)",
          }}
        >
          {pill}
        </span>
      </div>

      <div
        className="relative w-full overflow-hidden"
        style={{
          marginTop: 14,
          height: 150,
          borderRadius: 14,
          background:
            "radial-gradient(closest-side, rgba(0,188,135,0.22), rgba(0,188,135,0) 100%), var(--bg-elevated)",
        }}
      >
        {scene ? (
          scene
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {showImage ? (
              <Icon
                aria-hidden
                style={{ height: 44, width: 44, color: "var(--accent)" }}
                strokeWidth={1.25}
              />
            ) : null}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2" style={{ marginTop: 12, columnGap: 16, rowGap: 8 }}>
        {list.map((c) => (
          <Cell key={c.label} label={c.label} value={c.value} status={c.status} />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3" style={{ height: 24 }}>
        <span className="lp-caption" style={{ color: "var(--text-muted)" }}>
          {done} z {total} pól
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          {list.map((c) => (
            <span
              key={c.label}
              className="rounded-full border"
              style={{
                height: 6,
                width: 6,
                background: c.status !== "empty" ? "var(--accent)" : "transparent",
                borderColor:
                  c.status !== "empty" ? "var(--accent)" : "var(--glass-border-strong)",
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

export default ProductCardWide;
