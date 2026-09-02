import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { ProductField } from "@/data/demo-products";

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

export function FieldRow({ field }: { field: ProductField }) {
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

