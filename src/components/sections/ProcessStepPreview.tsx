import { Check, Store } from "lucide-react";
import { Pill } from "@/components/ui-custom/Pill";
import { ProductIconGlyph } from "@/components/product/ProductIcon";
import { heroProduct } from "@/data/demo-products";
import type { ProcessPreview } from "@/data/process-steps";

const boxStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--glass-border)",
  borderRadius: 12,
} as const;

function FilePreview() {
  const rows = ["nazwa;WORKI TIGRO 120L", "ean;5906154012072", "kod;TIG-120-25"];
  return (
    <div className="flex flex-col gap-1 p-3" style={boxStyle}>
      {rows.map((r) => (
        <span
          key={r}
          className="truncate text-[11px]"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--text-muted)" }}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

function CheckRow({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
      <Check aria-hidden className="h-3 w-3" strokeWidth={3} style={{ color: "var(--accent)" }} />
      {text}
    </span>
  );
}

function SourcesPreview() {
  return (
    <div className="flex flex-col gap-2 p-3" style={boxStyle}>
      {["producent.pl", "sklep-partner.pl", "katalog-branzowy.pl"].map((d) => (
        <CheckRow key={d} text={d} />
      ))}
      <span className="mt-1">
        <Pill variant="accent">EAN zgodny</Pill>
      </span>
    </div>
  );
}

function CopyPreview() {
  return (
    <div className="flex flex-col gap-2 p-3" style={boxStyle}>
      <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
        Worki na śmieci Tigro 120 l, folia LDPE...
      </span>
      {[92, 78, 56].map((w) => (
        <span
          key={w}
          className="block h-1.5 rounded-full"
          style={{ width: `${w}%`, background: "var(--accent)", opacity: 0.75 }}
        />
      ))}
      <span className="mt-1">
        <Pill variant="accent">SEO</Pill>
      </span>
    </div>
  );
}

function PhotoPreview() {
  return (
    <div className="flex items-center gap-3 p-3" style={boxStyle}>
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md"
        style={{ background: "#ffffff" }}
      >
        <ProductIconGlyph icon={heroProduct.icon} className="h-6 w-6" color="#0e1013" />
      </span>
      <Pill variant="neutral">packshot</Pill>
    </div>
  );
}

function QcPreview() {
  return (
    <div className="flex flex-col gap-2 p-3" style={boxStyle}>
      {["kompletność", "zgodność z EAN", "białe tło"].map((t) => (
        <CheckRow key={t} text={t} />
      ))}
      <span
        className="mt-1 flex h-7 w-7 items-center justify-center rounded-full border text-[10px]"
        style={{
          borderColor: "var(--glass-border-strong)",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-body)",
        }}
        aria-label="Redaktor"
      >
        RD
      </span>
    </div>
  );
}

function PublishPreview() {
  return (
    <div className="flex items-center gap-3 p-3" style={boxStyle}>
      <Pill variant="accent">Zatwierdzone</Pill>
      <Store aria-hidden className="h-5 w-5" strokeWidth={1.5} style={{ color: "var(--text-secondary)" }} />
    </div>
  );
}

const MAP = {
  file: FilePreview,
  sources: SourcesPreview,
  copy: CopyPreview,
  photo: PhotoPreview,
  qc: QcPreview,
  publish: PublishPreview,
} as const;

export function StepPreview({ preview }: { preview: ProcessPreview }) {
  const Component = MAP[preview];
  return <Component />;
}

export default StepPreview;
