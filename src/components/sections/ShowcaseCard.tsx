import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ProductCard } from "@/components/product/ProductCard";
import { ProductPlaceholderImage } from "@/components/product/ProductIcon";
import { fieldsFromValues, FIELD_ORDER, type ShowcaseProduct } from "@/data/demo-products";
import type { ShowcaseState } from "./StateToggle";

function CopyCard({ product, state }: { product: ShowcaseProduct; state: ShowcaseState }) {
  const sentences = product.copy.description.split(". ").slice(0, 2).join(". ");
  return (
    <div
      className="lp-glass mt-4 flex flex-col gap-3 p-4"
      style={{
        background: "var(--glass-bg)",
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      {state === "after" ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <span className="lp-caption" style={{ color: "var(--accent)" }}>
              Tytuł SEO
            </span>
            <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>
              {product.copy.seoTitle}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="lp-caption" style={{ color: "var(--accent)" }}>
              Opis
            </span>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {sentences.endsWith(".") ? sentences : `${sentences}.`}
            </p>
          </div>
        </motion.div>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            Brak opisu
          </span>
          {[70, 90, 50].map((w) => (
            <span
              key={w}
              className="block h-1.5 rounded-full"
              style={{ width: `${w}%`, background: "rgba(255,255,255,0.10)" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ShowcaseCard({
  product,
  state,
}: {
  product: ShowcaseProduct;
  state: ShowcaseState;
}) {
  const reduced = useReducedMotion();
  const total = FIELD_ORDER.length;
  const [visible, setVisible] = useState<number>(total);

  useEffect(() => {
    if (reduced) {
      setVisible(total);
      return;
    }
    setVisible(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setVisible(i);
      if (i >= total) window.clearInterval(id);
    }, 60);
    return () => window.clearInterval(id);
  }, [state, reduced, total]);

  const data = state === "after" ? product.after : product.before;
  const fields = fieldsFromValues(data.values, state === "after" ? "verified" : "ai", visible);

  return (
    <div className="w-[280px] shrink-0 snap-center">
      <ProductCard
        title={state === "after" ? "GOTOWE DO SPRZEDAŻY" : "NOWY"}
        badge={state === "after" ? { text: "Karta gotowa", variant: "accent" } : undefined}
        image={
          state === "after" && (product.imageMain ?? product.imageScene)
            ? (product.imageMain ?? product.imageScene)!
            : <ProductPlaceholderImage />
        }
        imageAlt={state === "after" ? product.name : ""}
        fields={fields}
        highlight={state === "after" ? "accent" : "none"}
        width="100%"
      />
      <CopyCard product={product} state={state} />
    </div>
  );
}

export default ShowcaseCard;
