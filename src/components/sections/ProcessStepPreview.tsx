import { Check } from "lucide-react";
import { ProductIconGlyph } from "@/components/product/ProductIcon";
import { heroProduct } from "@/data/demo-products";
import type { ProcessPreview } from "@/data/process-steps";

/** Wspólna rama podglądu: glass strong, 168px, treść u góry, pigułka na dole. */
function PreviewFrame({
  children,
  pill,
}: {
  children: React.ReactNode;
  pill: string;
}) {
  return (
    <div
      className="lp-glass flex h-[168px] flex-col items-start justify-start"
      style={{
        background: "var(--glass-bg-strong)",
        border: "1px solid var(--glass-border-strong)",
        borderRadius: 14,
        padding: 14,
      }}
    >
      <div className="flex w-full flex-1 flex-col items-start gap-2 overflow-hidden">
        {children}
      </div>
      <span
        className="mt-2 inline-flex h-6 items-center whitespace-nowrap px-2.5 text-[11px] font-medium"
        style={{
          background: "var(--accent-soft)",
          color: "var(--accent)",
          borderRadius: "var(--radius-pill)",
          fontFamily: "var(--font-body)",
        }}
      >
        {pill}
      </span>
    </div>
  );
}

function CheckRow({ text }: { text: string }) {
  return (
    <span
      className="flex w-full items-center gap-2 truncate text-[12px]"
      style={{ color: "var(--text-secondary)" }}
    >
      <Check aria-hidden className="h-3 w-3 shrink-0" strokeWidth={3} style={{ color: "var(--accent)" }} />
      {text}
    </span>
  );
}

function FilePreview() {
  const rows = ["nazwa;WORKI TIGRO 120L", "ean;5906154012072", "kod;TIG-120-25"];
  return (
    <PreviewFrame pill="CSV">
      {rows.map((r) => (
        <span
          key={r}
          className="w-full truncate text-[12px]"
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "var(--text-muted)",
          }}
        >
          {r}
        </span>
      ))}
    </PreviewFrame>
  );
}

function SourcesPreview() {
  return (
    <PreviewFrame pill="EAN zgodny">
      {["producent.pl", "sklep-partner.pl", "katalog-branzowy.pl"].map((d) => (
        <CheckRow key={d} text={d} />
      ))}
    </PreviewFrame>
  );
}

function CopyPreview() {
  return (
    <PreviewFrame pill="SEO">
      <span className="w-full truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
        Worki na śmieci Tigro 120 l, folia LDPE
      </span>
      {[92, 68].map((w) => (
        <span
          key={w}
          className="block h-1.5 rounded-full"
          style={{ width: `${w}%`, background: "var(--accent)", opacity: 0.75 }}
        />
      ))}
    </PreviewFrame>
  );
}

function PhotoPreview() {
  return (
    <PreviewFrame pill="zdjęcia">
      <div className="flex w-full items-center gap-3">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center"
          style={{ background: "#ffffff", borderRadius: 10 }}
        >
          <ProductIconGlyph icon={heroProduct.icon} className="h-7 w-7" color="var(--bg-base)" />
        </span>
        <span
          className="min-w-0 text-[12px] leading-snug"
          style={{ color: "var(--text-secondary)" }}
        >
          packshot
          <br />i aranżacja
        </span>
      </div>
    </PreviewFrame>
  );
}

function QcPreview() {
  return (
    <PreviewFrame pill="redaktor">
      {["kompletność", "zgodność z EAN", "białe tło"].map((t) => (
        <CheckRow key={t} text={t} />
      ))}
    </PreviewFrame>
  );
}

function PublishPreview() {
  return (
    <PreviewFrame pill="publikacja">
      <div className="flex w-full items-center gap-2">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px]"
          style={{
            borderColor: "var(--glass-border-strong)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-body)",
          }}
        >
          Ty
        </span>
        <span className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
          Zatwierdzone
        </span>
      </div>
    </PreviewFrame>
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
