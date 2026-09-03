import { Package, type LucideIcon } from "lucide-react";

/** Placeholder packshotu: ikona produktu 44px na zielonej poświacie. */
export function ProductPlaceholderImage({ icon: Icon = Package }: { icon?: LucideIcon }) {
  return (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center"
      style={{
        background:
          "radial-gradient(closest-side, rgba(0,188,135,0.22), rgba(0,188,135,0) 100%), var(--bg-elevated)",
      }}
    >
      <Icon style={{ color: "var(--accent)", height: 44, width: 44 }} strokeWidth={1.25} />
    </div>
  );
}

export default ProductPlaceholderImage;
