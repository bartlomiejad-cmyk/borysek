import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PillProps = {
  variant?: "accent" | "amber" | "neutral";
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
};

export function Pill({ variant = "accent", icon: Icon, className, children }: PillProps) {
  const styles =
    variant === "accent"
      ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "transparent" }
      : variant === "amber"
        ? { background: "var(--amber-soft)", color: "var(--amber)", borderColor: "transparent" }
        : {
            background: "var(--glass-bg)",
            color: "var(--text-secondary)",
            borderColor: "var(--glass-border)",
          };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-3 py-1 text-[0.8125rem] font-medium",
        className,
      )}
      style={{ ...styles, borderRadius: "var(--radius-pill)", fontFamily: "var(--font-body)" }}
    >
      {Icon ? <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

export default Pill;
