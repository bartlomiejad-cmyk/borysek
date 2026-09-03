import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Coffee, Store } from "lucide-react";
import { DEMO_EAN, RAW_NAME, type ProcessScene as SceneId } from "@/data/process-steps";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

function ScenePill({ text, accent = false }: { text: string; accent?: boolean }) {
  return (
    <span
      className="inline-flex w-fit items-center whitespace-nowrap px-2.5 text-[11px] font-medium"
      style={{
        height: 22,
        background: accent ? "var(--accent-soft)" : "var(--glass-bg-strong)",
        color: accent ? "var(--accent)" : "var(--text-secondary)",
        border: accent ? "1px solid transparent" : "1px solid var(--glass-border)",
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font-body)",
      }}
    >
      {text}
    </span>
  );
}

function CheckRow({ text }: { text: string }) {
  return (
    <span
      className="flex w-full min-w-0 items-center gap-2 truncate whitespace-nowrap text-[12.5px]"
      style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}
    >
      <Check
        aria-hidden
        className="h-[13px] w-[13px] shrink-0"
        strokeWidth={3}
        style={{ color: "var(--accent)" }}
      />
      <span className="truncate">{text}</span>
    </span>
  );
}

function FileScene() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-1.5 px-4">
      <span className="absolute right-3 top-3">
        <ScenePill text="plik CSV" />
      </span>
      {[`nazwa; ${RAW_NAME}`, `ean; ${DEMO_EAN}`].map((row) => (
        <span
          key={row}
          className="w-full truncate whitespace-nowrap text-[12px]"
          style={{ fontFamily: MONO, color: "var(--text-muted)" }}
        >
          {row}
        </span>
      ))}
    </div>
  );
}

function SourcesScene() {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-1.5 px-4">
      {["producent.pl", "sklep-partner.pl", "katalog-branzowy.pl"].map((host) => (
        <CheckRow key={host} text={host} />
      ))}
      <ScenePill text={`EAN ${DEMO_EAN} zgodny`} accent />
    </div>
  );
}

function CopyScene({ reduced }: { reduced: boolean }) {
  const widths = [90, 70, 80, 50];
  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-4">
      {widths.map((w, i) => (
        <motion.span
          key={w}
          className="block rounded-full"
          initial={reduced ? false : { opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.3, delay: reduced ? 0 : i * 0.15 }}
          style={{
            transformOrigin: "left",
            height: 6,
            width: `${w}%`,
            background: "var(--accent)",
            opacity: 0.85,
          }}
        />
      ))}
      <span className="mt-1">
        <ScenePill text="8 pól wygenerowanych" />
      </span>
    </div>
  );
}

function PhotoScene() {
  return (
    <div className="flex h-full w-full items-center justify-center gap-3 px-4">
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ height: 96, width: 96, background: "#ffffff", borderRadius: 12 }}
      >
        <Coffee
          aria-hidden
          style={{ height: 40, width: 40, color: "var(--bg-base)" }}
          strokeWidth={1.5}
        />
      </span>
      <ScenePill text="packshot" />
    </div>
  );
}

function QcScene() {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-1.5 px-4">
      {["kompletność 10/10", "zgodność z EAN", "białe tło packshotu"].map((t) => (
        <CheckRow key={t} text={t} />
      ))}
      <span className="mt-1 flex items-center gap-2">
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
          RD
        </span>
        <span className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>
          redaktor: 2 poprawki
        </span>
      </span>
    </div>
  );
}

function PublishScene() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <ScenePill text="Zatwierdzone" accent />
      <Store aria-hidden style={{ height: 28, width: 28, color: "var(--accent)" }} strokeWidth={1.5} />
    </div>
  );
}

export function ProcessSceneView({ scene }: { scene: SceneId }) {
  const reduced = useReducedMotion() ?? false;
  const content =
    scene === "file" ? (
      <FileScene />
    ) : scene === "sources" ? (
      <SourcesScene />
    ) : scene === "copy" ? (
      <CopyScene reduced={reduced} />
    ) : scene === "photo" ? (
      <PhotoScene />
    ) : scene === "qc" ? (
      <QcScene />
    ) : (
      <PublishScene />
    );

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={scene}
        className="absolute inset-0"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}

export default ProcessSceneView;
