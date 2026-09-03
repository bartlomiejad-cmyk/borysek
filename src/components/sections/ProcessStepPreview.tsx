import { Check, Coffee } from "lucide-react";
import type { ProcessPreview } from "@/data/process-steps";

/** Rama podglądu: 120px, treść u góry, jedna pigułka 24px na dole. */
function PreviewFrame({ children, pill }: { children: React.ReactNode; pill: string }) {
  return (
    <div
      className="lp-glass lp-step-preview flex w-full flex-col justify-between"
      style={{
        height: 120,
        background: "var(--glass-bg-strong)",
        border: "1px solid var(--glass-border-strong)",
        borderRadius: 14,
        padding: 14,
      }}
    >
      <div className="flex w-full min-w-0 flex-col gap-1.5 overflow-hidden">{children}</div>
      <span
        className="lp-step-preview-pill inline-flex w-fit items-center whitespace-nowrap px-2.5 text-[11px] font-medium"
        style={{
          height: 24,
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

function Line({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex w-full min-w-0 items-center gap-2 truncate whitespace-nowrap text-[13px]"
      style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
    >
      {children}
    </span>
  );
}

function CheckLine({ text }: { text: string }) {
  return (
    <Line>
      <Check
        aria-hidden
        className="h-[14px] w-[14px] shrink-0"
        strokeWidth={3}
        style={{ color: "var(--accent)" }}
      />
      <span className="truncate">{text}</span>
    </Line>
  );
}

function FilePreview() {
  return (
    <PreviewFrame pill="CSV">
      {["nazwa; EKSPRES CISNIENIOWY AUTOMAT 15BAR", "ean; 5901234123457"].map((r) => (
        <span
          key={r}
          className="w-full truncate whitespace-nowrap text-[12px]"
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
      <CheckLine text="producent.pl" />
      <CheckLine text="sklep-partner.pl" />
    </PreviewFrame>
  );
}

function CopyPreview() {
  return (
    <PreviewFrame pill="SEO">
      <Line>
        <span className="truncate">Ekspres ciśnieniowy automatyczny 15 bar</span>
      </Line>
      <span
        className="block rounded-full"
        style={{ height: 5, width: "70%", background: "var(--accent)", opacity: 0.85 }}
      />
    </PreviewFrame>
  );
}

function PhotoPreview() {
  return (
    <PreviewFrame pill="zdjęcia">
      <div className="flex w-full min-w-0 items-center gap-3">
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ height: 36, width: 36, background: "#ffffff", borderRadius: 8 }}
        >
          <Coffee
            aria-hidden
            className="h-[18px] w-[18px]"
            strokeWidth={1.5}
            style={{ color: "var(--bg-base)" }}
          />
        </span>
        <Line>
          <span className="truncate">packshot i aranżacja</span>
        </Line>
      </div>
    </PreviewFrame>
  );
}

function QcPreview() {
  return (
    <PreviewFrame pill="redaktor">
      <CheckLine text="kompletność" />
      <CheckLine text="zgodność z EAN" />
    </PreviewFrame>
  );
}

function PublishPreview() {
  return (
    <PreviewFrame pill="publikacja">
      <div className="flex w-full min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center rounded-full border text-[10px]"
          style={{
            height: 22,
            width: 22,
            borderColor: "var(--glass-border-strong)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-body)",
          }}
        >
          Ty
        </span>
        <CheckLine text="Zatwierdzone" />
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
