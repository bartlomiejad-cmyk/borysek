import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Size = "md" | "lg";

type BaseProps = ButtonHTMLAttributes<HTMLButtonElement> & { size?: Size };

const sizeClass: Record<Size, string> = {
  md: "h-11 px-5 text-[0.9375rem]",
  lg: "h-14 px-7 text-base",
};

const base =
  "inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-0 disabled:opacity-50 disabled:pointer-events-none motion-reduce:transition-none";

export function AccentButton({ size = "md", className, style, ...props }: BaseProps) {
  return (
    <button
      {...props}
      className={cn(
        base,
        sizeClass[size],
        "lp-accent-btn hover:-translate-y-px motion-reduce:hover:translate-y-0",
        className,
      )}
      style={{
        background: "var(--accent)",
        color: "var(--accent-ink)",
        borderRadius: "var(--radius-button)",
        fontFamily: "var(--font-body)",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--accent-hover)";
        e.currentTarget.style.boxShadow = "0 0 24px var(--accent-glow)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--accent)";
        e.currentTarget.style.boxShadow = "none";
      }}
    />
  );
}

export function GhostButton({ size = "md", className, style, ...props }: BaseProps) {
  return (
    <button
      {...props}
      className={cn(base, sizeClass[size], "border backdrop-blur-[20px]", className)}
      style={{
        background: "transparent",
        borderColor: "var(--glass-border-strong)",
        color: "var(--text-primary)",
        borderRadius: "var(--radius-button)",
        fontFamily: "var(--font-body)",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--glass-bg-strong)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    />
  );
}
