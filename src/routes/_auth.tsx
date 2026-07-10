import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState, useParams } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { LogOut, FlaskConical, FolderKanban, ShieldCheck, Menu, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isFullscreen = /\/preview\/?$/.test(pathname);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setEmail(session?.user.email ?? null);
      if (event === "SIGNED_OUT") navigate({ to: "/login" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="relative min-h-screen flex w-full bg-background">
      {/* dekoracyjny glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-0 h-[36rem] w-[36rem] rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--primary), transparent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-20 h-[28rem] w-[28rem] rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--accent), transparent)" }}
      />

      {/* Desktop sidebar (fixed, zawsze widoczny) */}
      {!isFullscreen && (
        <aside className="hidden md:flex fixed left-0 top-0 z-30 h-screen w-[260px] flex-col gap-2 border-r border-border/40 bg-card/60 backdrop-blur-xl px-4 py-5">
          <SidebarBrand />
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
          <div className="mt-auto">
            <SidebarFooter email={email} onSignOut={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/login" });
            }} />
          </div>
        </aside>
      )}

      {/* Main column */}
      <div className={cn("relative flex-1 min-w-0 flex flex-col", !isFullscreen && "md:ml-[260px]")}>
        {/* Mobile topbar */}
        {!isFullscreen && (
          <header className="md:hidden sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/40 bg-background/70 backdrop-blur-xl px-4 h-14">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] bg-card/95 backdrop-blur-xl p-4 flex flex-col gap-2">
                <SidebarBrand />
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
                <div className="mt-auto">
                  <SidebarFooter email={email} onSignOut={async () => {
                    await supabase.auth.signOut();
                    navigate({ to: "/login" });
                  }} />
                </div>
              </SheetContent>
            </Sheet>
            <Link to="/projects" className="flex items-center gap-2">
              <BrandMark />
              <span className="font-serif text-lg">AI Enricher</span>
            </Link>
            <span className="w-9" />
          </header>
        )}

        <main className="relative flex-1 animate-fade-in">
          <Outlet />
        </main>
      </div>

      <Toaster richColors />
    </div>
  );
}

function BrandMark() {
  return (
    <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
      <FlaskConical className="h-4 w-4" />
      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent border-2 border-card" />
    </span>
  );
}

function SidebarBrand() {
  return (
    <Link to="/projects" className="flex items-center gap-3 px-1 py-2">
      <BrandMark />
      <div className="flex flex-col leading-tight">
        <span className="font-serif text-2xl tracking-tight">AI Enricher</span>
        <span className="inline-flex w-fit items-center rounded-full bg-muted/70 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          Experiment
        </span>
      </div>
    </Link>
  );
}

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; match: (path: string) => boolean };

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Try to detect current project id from URL
  const projectId = (useParams({ strict: false }) as { id?: string }).id;

  const items: NavItem[] = [
    {
      to: "/projects",
      label: "Projekty",
      icon: FolderKanban,
      match: (p) => p === "/projects" || p === "/projects/",
    },
  ];

  if (projectId) {
    items.push(
      {
        to: `/projects/${projectId}`,
        label: "Katalog",
        icon: Sparkles,
        match: (p) => p === `/projects/${projectId}` || p.startsWith(`/projects/${projectId}/products`),
      },
      {
        to: `/projects/${projectId}/verify`,
        label: "Weryfikacja",
        icon: ShieldCheck,
        match: (p) => p.startsWith(`/projects/${projectId}/verify`),
      },
    );
  }

  return (
    <nav className="flex flex-col gap-1 mt-2">
      {items.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-2xl px-3 h-11 text-sm font-medium transition-all",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", active && "text-primary-foreground")} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter({ email, onSignOut }: { email: string | null; onSignOut: () => void | Promise<void> }) {
  const initial = (email?.[0] ?? "?").toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/40 p-2 pr-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground font-semibold">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{email ?? "—"}</p>
      </div>
      <Button variant="ghost" size="icon" className="rounded-full h-8 w-8" onClick={onSignOut} title="Wyloguj">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
