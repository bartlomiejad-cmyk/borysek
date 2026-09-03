import { motion } from "framer-motion";
import { Check, Package } from "lucide-react";
import { heroWideFields } from "@/data/demo-products";

const CELL_H = 50;

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

function Cell({ label, value, filled }: { label: string; value: string | null; filled: boolean }) {
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
        {filled ? (
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
  /** Liczba wypełnionych komórek (0..10). */
  filled: number;
  /** Zdjęcie produktu; brak = placeholder z ikoną Package. */
  image?: string | null;
  imageAlt?: string;
  showImage?: boolean;
};

export function ProductCardWide({
  filled,
  image = null,
  imageAlt = "",
  showImage = true,
}: ProductCardWideProps) {
  const total = heroWideFields.length;
  return (
    <div
      className="lp-glass w-full"
      style={{
        maxWidth: 460,
        padding: 20,
        borderRadius: 24,
        background: "var(--glass-bg)",
        border: "1.5px solid var(--accent)",
        boxShadow: "var(--glass-highlight), var(--glass-shadow)",
      }}
    >
      <div className="flex items-center justify-between gap-3" style={{ height: 28 }}>
        <span className="lp-caption truncate" style={{ color: "var(--text-secondary)" }}>
          GOTOWE DO SPRZEDAŻY
        </span>
        <span
          className="inline-flex shrink-0 items-center px-3 py-1 text-[0.8125rem] font-medium"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
            borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-body)",
          }}
        >
          Opublikowano
        </span>
      </div>

      <div
        className="relative flex w-full items-center justify-center overflow-hidden"
        style={{
          marginTop: 14,
          height: 150,
          borderRadius: 14,
          background: "var(--bg-elevated)",
        }}
      >
        {showImage && image ? (
          <img src={image} alt={imageAlt} loading="lazy" className="h-full w-full object-cover" />
        ) : showImage ? (
          <Package aria-hidden className="h-10 w-10" strokeWidth={1.25} style={{ color: "var(--accent)" }} />
        ) : null}
      </div>

      <div
        className="grid grid-cols-2"
        style={{ marginTop: 12, columnGap: 16, rowGap: 8 }}
      >
        {heroWideFields.map((f, i) => (
          <Cell key={f.label} label={f.label} value={f.value} filled={i < filled} />
        ))}
      </div>

      <div
        className="mt-2 flex items-center justify-between gap-3"
        style={{ height: 24 }}
      >
        <span className="lp-caption" style={{ color: "var(--text-muted)" }}>
          {filled} z {total} pól
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          {heroWideFields.map((f, i) => (
            <span
              key={f.label}
              className="rounded-full border"
              style={{
                height: 6,
                width: 6,
                background: i < filled ? "var(--accent)" : "transparent",
                borderColor: i < filled ? "var(--accent)" : "var(--glass-border-strong)",
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

export default ProductCardWide;
