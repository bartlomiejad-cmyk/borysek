import { Link, useLocation } from "@tanstack/react-router";
import { Boxes, Camera } from "lucide-react";

/**
 * Small tab bar shown at the top of the two "workspace" routes
 * (/projects and /photo). Kept intentionally minimal so it can live
 * inside each page without needing a shared layout route.
 */
export function TopTabs() {
  const { pathname } = useLocation();
  const tabs = [
    { to: "/projects", label: "Projekty PIM", icon: Boxes, active: pathname.startsWith("/projects") },
    { to: "/photo", label: "Zdjęcia", icon: Camera, active: pathname.startsWith("/photo") },
  ] as const;
  return (
    <div className="mx-auto max-w-5xl px-6 pt-8">
      <div className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-card/60 backdrop-blur-sm p-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={
                "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors " +
                (t.active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}