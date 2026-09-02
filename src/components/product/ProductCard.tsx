import { motion } from "framer-motion";
import { Check, Package } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui-custom/Pill";
import type { ProductField } from "@/data/demo-products";

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
  className?: string;
};

const barColor = (value: number) =>
  value < 30 ? "var(--danger)" : value < 80 ? "var(--amber)" : "var(--accent)";

function StatusDot({ status }: { status: ProductField["status"] }) {
  if (status === "verified") {
    return (
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--accent)" }}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} style={{ color: "var(--accent-ink)" }} />
      </span>
    );
  }
  if (status === "ai") {
    return (
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--accent-soft)" }}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} style={{ color: "var(--accent)" }} />
      </span>
    );
  }
  return (
    <span
      className="h-4 w-4 shrink-0 rounded-full border"
      style={{ borderColor: "var(--glass-border-strong)" }}
    />
  );
}

function LongValue({ status }: { status: ProductField["status"] }) {
  const filled = status !== "empty";
  return (
    <span className="flex w-full flex-col gap-1">
      {[60, 85, 45].map((w) => (
        <motion.span
          key={w}
          layout
          initial={false}
          animate={{ opacity: 1 }}
          className="block h-1.5 rounded-full"
          style={{
            width: `${w}%`,
            background: filled ? "var(--accent)" : "rgba(255,255,255,0.10)",
            opacity: filled ? 0.85 : 1,
          }}
        />
      ))}
    </span>
  );
}

function FieldRow({ field }: { field: ProductField }) {
  return (
    <motion.li
      layout
      className="flex items-center gap-3 py-1.5"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <span className="w-[68px] shrink-0 text-[12px]" style={{ color: "var(--text-muted)" }}>
        {field.label}
      </span>
      <span className="min-w-0 flex-1">
        {field.long ? (
          <LongValue status={field.status} />
        ) : (
          <motion.span
            key={`${field.label}-${field.status}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="block truncate text-[13px]"
            style={{
              color: field.status === "empty" ? "var(--text-muted)" : "var(--text-primary)",
            }}
          >
            {field.status === "empty" ? "—" : field.value}
          </motion.span>
        )}
      </span>
      <StatusDot status={field.status} />
    </motion.li>
  );
}

export function ProductCard({
  title,
  stepNumber,
  badge,
  image,
  fields,
  completeness,
  highlight = "none",
  width = 280,
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
      className={cn("overflow-hidden backdrop-blur-[20px]", className)}
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
            <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : image ? (
            image
          ) : (
            <Package className="h-8 w-8" style={{ color: "var(--text-muted)" }} />
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
