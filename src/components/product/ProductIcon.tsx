import { Package } from "lucide-react";

/** Placeholder packshotu: ciemny gradient z ikoną Package. */
export function ProductPlaceholderImage() {
  return (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center"
      style={{
        background:
          "radial-gradient(120% 100% at 50% 0%, rgba(0,188,135,0.18), rgba(14,16,19,1) 70%)",
      }}
    >
      <Package className="h-12 w-12" strokeWidth={1.25} style={{ color: "var(--accent)" }} />
    </div>
  );
}

export default ProductPlaceholderImage;
