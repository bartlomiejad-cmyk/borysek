import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  lead?: string;
  align?: "left" | "center";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "items-center text-center mx-auto max-w-3xl" : "items-start text-left",
        className,
      )}
    >
      {eyebrow ? (
        <span className="lp-caption" style={{ color: "var(--accent)" }}>
          {eyebrow}
        </span>
      ) : null}
      <h2 className="lp-h2" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
      {lead ? (
        <p className="lp-lead max-w-2xl" style={{ color: "var(--text-secondary)" }}>
          {lead}
        </p>
      ) : null}
    </div>
  );
}

export default SectionHeading;
