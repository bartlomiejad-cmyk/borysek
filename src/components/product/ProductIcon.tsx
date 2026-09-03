import { Droplets, Trash2, Wrench } from "lucide-react";
import type { ProductIcon as ProductIconName } from "@/data/demo-products";

const ICONS = { trash: Trash2, droplets: Droplets, wrench: Wrench } as const;

export function ProductIconGlyph({
  icon,
  className = "h-6 w-6",
  color = "var(--accent)",
}: {
  icon: ProductIconName;
  className?: string;
  color?: string;
}) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden className={className} strokeWidth={1.25} style={{ color }} />;
}

/** Placeholder packshotu: ciemny gradient z ikoną produktu. */
export function ProductPlaceholderImage({ icon }: { icon: ProductIconName }) {
  return (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center"
      style={{
        background:
          "radial-gradient(120% 100% at 50% 0%, rgba(0,188,135,0.18), rgba(14,16,19,1) 70%)",
      }}
    >
      <ProductIconGlyph icon={icon} className="h-12 w-12" />
    </div>
  );
}

export default ProductPlaceholderImage;
