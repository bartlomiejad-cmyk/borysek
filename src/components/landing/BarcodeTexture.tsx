/** Deterministyczny rytm kresek: szerokość kreski i szerokość przerwy. */
const WIDTHS = [1, 2, 1, 3, 1, 1, 2, 3, 2, 1, 1, 2];
const GAPS = [4, 7, 3, 5, 9, 4, 6, 3, 8, 5, 4, 7];
const BARS = 160;

type Bar = { x: number; w: number };

function buildBars(): Bar[] {
  const raw: Bar[] = [];
  let x = 0;
  for (let i = 0; i < BARS; i++) {
    const w = WIDTHS[i % WIDTHS.length]!;
    raw.push({ x, w });
    x += w + GAPS[i % GAPS.length]!;
  }
  const total = x;
  // Skalujemy do 100% szerokości (viewBox 1000).
  return raw.map((b) => ({ x: (b.x / total) * 1000, w: (b.w / total) * 1000 }));
}

const BARS_DATA = buildBars();

const MASK =
  "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 70%), linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 15%, rgba(0,0,0,1) 85%, rgba(0,0,0,0) 100%)";

/** Statyczna warstwa tekstury kodu kreskowego na tle sekcji. */
export function BarcodeTexture() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 0,
        opacity: 0.07,
        maskImage: MASK,
        WebkitMaskImage: MASK,
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        focusable="false"
      >
        {BARS_DATA.map((b, i) => (
          <rect key={i} x={b.x} y={0} width={b.w} height={100} fill="var(--accent)" />
        ))}
      </svg>
    </div>
  );
}

export default BarcodeTexture;
