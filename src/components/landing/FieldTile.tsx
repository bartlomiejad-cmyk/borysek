import type { LucideIcon } from "lucide-react";

type FieldTileProps = {
  icon: LucideIcon;
  label: string;
  badge: string;
  planned?: boolean;
};

export function FieldTile({ icon: Icon, label, badge, planned = false }: FieldTileProps) {
  const ringColor = planned ? "var(--text-muted)" : "var(--accent)";

  return (
    <div className="group flex flex-col items-center gap-4">
      <div
        className="relative h-[148px] w-[148px] rounded-full p-[2px] transition-transform duration-300 md:group-hover:-translate-y-1"
        style={{
          background: `conic-gradient(from 140deg, ${ringColor}, transparent 55%, ${ringColor})`,
        }}
      >
        <div
          className="flex h-full w-full items-center justify-center rounded-full border"
          style={{
            background: "var(--glass-bg)",
            borderColor: "var(--glass-border)",
            boxShadow: "var(--glass-highlight)",
          }}
        >
          <span
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full"
            style={{ background: "var(--bg-elevated)" }}
          >
            <Icon aria-hidden size={32} style={{ color: planned ? "var(--text-muted)" : "var(--accent)" }} />
          </span>
        </div>
        <span
          className="absolute bottom-2 right-0 rounded-full border px-2.5 py-1 text-[11px] transition-shadow duration-300"
          style={{
            background: planned ? "var(--glass-bg)" : "var(--glass-bg-strong)",
            borderColor: "var(--glass-border-strong)",
            color: planned ? "var(--text-secondary)" : "var(--text-primary)",
          }}
        >
          {badge}
        </span>
      </div>
      <span className="lp-caption text-center" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
    </div>
  );
}

export default FieldTile;
