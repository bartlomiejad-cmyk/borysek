import { motion } from "framer-motion";
import { Package } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui-custom/Pill";
import { FIELD_ORDER, type ProductField } from "@/data/demo-products";
import { FieldRow } from "./ProductCardField";

type Highlight = "accent" | "human" | "none";

export type ProductCardProps = {
  title: string;
  stepNumber?: number;
  badge?: { text: string; variant?: "accent" | "neutral" };
  image?: ReactNode | string;
  fields: ProductField[];
  highlight?: Highlight;
  width?: number | string;
  /** Rozmycie tła: wyłączamy je w długich listach kart (wydajność). */
  blur?: boolean;
  /** Opis zdjęcia po polsku; puste = ilustracja dekoracyjna. */
  imageAlt?: string;
  /** Wariant hero: szersza karta, zdjęcie 16:10, zwarte wiersze pól. */
  hero?: boolean;
  className?: string;
};

function Segments({ filled, total }: { filled: number; total: number }) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <motion.span
          key={i}
          initial={false}
          animate={{ opacity: 1 }}
          className="h-[6px] w-[6px] rounded-full border"
          style={{
            background: i < filled ? "var(--accent)" : "transparent",
            borderColor: i < filled ? "var(--accent)" : "var(--glass-border-strong)",
          }}
        />
      ))}
    </span>
  );
}

export function ProductCard({
  title,
  stepNumber,
  badge,
  image,
  fields,
  highlight = "none",
  width = 280,
  blur = true,
  imageAlt = "",
  hero = false,
  className,
}: ProductCardProps) {
  const total = fields.length || FIELD_ORDER.length;
  const filled = fields.filter((f) => f.status !== "empty").length;
  const highlightColor =
    highlight === "accent"
      ? "var(--accent)"
      : highlight === "human"
        ? "var(--text-secondary)"
        : null;
  const highlightSoft = highlight === "accent" ? "var(--accent-soft)" : "transparent";

  return (
    <motion.div
      layout
      className={cn("overflow-hidden", blur && "lp-glass", className)}
      style={{
        width,
        background: "var(--glass-bg)",
        border: highlightColor
          ? `1.5px solid ${highlightColor}`
          : "1px solid var(--glass-border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--glass-highlight), var(--glass-shadow)",
      }}
    >
      <div className="flex flex-col gap-2 px-5 py-4" style={{ background: highlightSoft }}>
        <div className="flex items-center gap-2">
          {typeof stepNumber === "number" ? (
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full border text-[11px]"
              style={{
                borderColor: "var(--glass-border-strong)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-body)",
              }}
            >
              {stepNumber}
            </span>
          ) : null}
          <span className="lp-caption" style={{ color: "var(--text-secondary)" }}>
            {title}
          </span>
        </div>
        {badge ? (
          <span>
            <Pill variant={badge.variant ?? "accent"}>{badge.text}</Pill>
          </span>
        ) : null}
      </div>

      <div className="px-5">
        <div
          className={`relative flex w-full items-center justify-center overflow-hidden ${hero ? "aspect-[16/10]" : "aspect-[4/3]"}`}
          style={{ borderRadius: 16, background: "var(--bg-elevated)" }}
        >
          {typeof image === "string" ? (
            <img src={image} alt={imageAlt} className="h-full w-full object-cover" loading="lazy" />
          ) : image ? (
            image
          ) : (
            <Package aria-hidden className="h-8 w-8" style={{ color: "var(--text-muted)" }} />
          )}
        </div>
      </div>

      <ul className={`flex flex-col px-5 ${hero ? "py-3" : "py-4"}`}>
        {fields.map((f) => (
          <FieldRow key={f.label} field={f} hero={hero} />
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3 px-5 pb-4">
        <p className="lp-caption" style={{ color: "var(--text-muted)" }}>
          {filled} z {total} pól
        </p>
        <Segments filled={filled} total={total} />
      </div>
    </motion.div>
  );
}

export default ProductCard;
