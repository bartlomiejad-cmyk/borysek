import { motion } from "framer-motion";
import { Package } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui-custom/Pill";
import type { ProductField } from "@/data/demo-products";
import { FieldRow } from "./ProductCardField";

type Highlight = "accent" | "amber" | "none";

export type ProductCardProps = {
  title: string;
  stepNumber?: number;
  badge?: { text: string; variant?: "accent" | "amber" | "neutral" };
  image?: ReactNode | string;
  fields: ProductField[];
  completeness: number;
  highlight?: Highlight;
  width?: number | string;
  /** Rozmycie tła: wyłączamy je w długich listach kart (wydajność). */
  blur?: boolean;
  /** Opis zdjęcia po polsku; puste = ilustracja dekoracyjna. */
  imageAlt?: string;
  className?: string;
};

const barColor = (value: number) =>
  value < 30 ? "var(--danger)" : value < 80 ? "var(--amber)" : "var(--accent)";

export function ProductCard({
  title,
  stepNumber,
  badge,
  image,
  fields,
  completeness,
  highlight = "none",
  width = 280,
  blur = true,
  imageAlt = "",
  className,
}: ProductCardProps) {
  const highlightColor =
    highlight === "accent" ? "var(--accent)" : highlight === "amber" ? "var(--amber)" : null;
  const highlightSoft =
    highlight === "accent"
      ? "var(--accent-soft)"
      : highlight === "amber"
        ? "var(--amber-soft)"
        : "transparent";

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
      <div
        className="flex flex-col gap-2 px-5 py-4"
        style={{ background: highlightSoft }}
      >
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
          className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden"
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

      <ul className="flex flex-col px-5 py-4">
        {fields.map((f) => (
          <FieldRow key={f.label} field={f} />
        ))}
      </ul>

      <div className="px-5 pb-4">
        <div className="h-[3px] w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
          <motion.div
            className="h-full rounded-full"
            initial={false}
            animate={{ width: `${Math.max(0, Math.min(100, completeness))}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ background: barColor(completeness) }}
          />
        </div>
        <p className="lp-caption mt-2" style={{ color: "var(--text-muted)" }}>
          {Math.round(completeness)}% kompletności
        </p>
      </div>
    </motion.div>
  );
}

export default ProductCard;
