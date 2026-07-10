import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: (search) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
});

function safeRedirectPath(redirect?: string) {
  if (!redirect) return "/projects";
  try {
    const url = redirect.startsWith("http") ? new URL(redirect) : new URL(redirect, window.location.origin);
    if (url.origin !== window.location.origin) return "/projects";
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!path.startsWith("/") || path.startsWith("//") || path === "/login") return "/projects";
    return path;
  } catch {
    return "/projects";
  }
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const redirectTo = safeRedirectPath(redirect);

  const navigateAfterLogin = () => navigate({ to: redirectTo });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigateAfterLogin();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigateAfterLogin();
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, redirectTo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/login?redirect=${encodeURIComponent(redirectTo)}` },
        });
        if (error) throw error;
        toast.success("Konto utworzone. Sprawdź email aby potwierdzić.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigateAfterLogin();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd logowania");
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/login?redirect=${encodeURIComponent(redirectTo)}`,
    });
    if (result.error) {
      toast.error(result.error.message);
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    navigateAfterLogin();
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Universal AI Product Enricher</CardTitle>
          <CardDescription>
            {mode === "signin" ? "Zaloguj się aby zarządzać projektami PIM." : "Załóż konto."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={google} variant="outline" className="w-full" disabled={loading}>
            Kontynuuj z Google
          </Button>
          <div className="relative text-center text-xs text-muted-foreground before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-border">
            <span className="relative bg-card px-2">lub</span>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Hasło</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {mode === "signin" ? "Zaloguj się" : "Zarejestruj"}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="text-sm text-muted-foreground hover:text-foreground w-full text-center"
          >
            {mode === "signin" ? "Nie masz konta? Zarejestruj się" : "Masz konto? Zaloguj się"}
          </button>
          <Link to="/" className="block text-xs text-center text-muted-foreground">Strona główna</Link>
        </CardContent>
      </Card>
    </main>
  );
}