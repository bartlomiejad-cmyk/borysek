export function PageBackground() {
  return (
    <div aria-hidden className="pointer-events-none">
      {/* Base color */}
      <div
        className="fixed inset-0 -z-30"
        style={{ background: "var(--bg-base)" }}
      />
      {/* Subtle grid */}
      <div
        className="fixed inset-0 -z-20"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
      {/* Accent blobs */}
      <div
        className="fixed -z-10 rounded-full"
        style={{
          top: "-12rem",
          right: "-10rem",
          width: "42rem",
          height: "42rem",
          opacity: 0.25,
          filter: "blur(80px)",
          background:
            "radial-gradient(closest-side, var(--accent), rgba(0,188,135,0))",
        }}
      />
      <div
        className="fixed -z-10 hidden rounded-full md:block"
        style={{
          top: "60%",
          left: "-14rem",
          width: "38rem",
          height: "38rem",
          opacity: 0.25,
          filter: "blur(80px)",
          background:
            "radial-gradient(closest-side, var(--accent), rgba(0,188,135,0))",
        }}
      />
    </div>
  );
}

export default PageBackground;
