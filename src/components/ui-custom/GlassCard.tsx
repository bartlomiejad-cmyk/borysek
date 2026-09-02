import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

type GlassCardProps = {
  variant?: "default" | "strong";
  padding?: "none" | "sm" | "md" | "lg";
  radius?: "card" | "lg";
  /** Rozmycie tła włączamy tylko tam, gdzie karta leży na poświacie lub treści. */
  blur?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

const paddings: Record<NonNullable<GlassCardProps["padding"]>, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8 md:p-10",
};

export function GlassCard({
  variant = "default",
  padding = "md",
  radius = "card",
  blur = true,
  className,
  style,
  children,
}: GlassCardProps) {
  return (
    <div
      className={cn("relative border", blur && "lp-glass", paddings[padding], className)}

      style={{
        background: variant === "strong" ? "var(--glass-bg-strong)" : "var(--glass-bg)",
        borderColor:
          variant === "strong" ? "var(--glass-border-strong)" : "var(--glass-border)",
        borderRadius: radius === "lg" ? "var(--radius-card-lg)" : "var(--radius-card)",
        boxShadow: "var(--glass-highlight), var(--glass-shadow)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default GlassCard;
