import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listProjects, createProject, deleteProject } from "@/lib/pim/projects.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { TopTabs } from "@/components/TopTabs";

export const Route = createFileRoute("/_auth/projects/")({ component: ProjectsPage });

function ProjectsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listProjects);
  const createFn = useServerFn(createProject);
  const delFn = useServerFn(deleteProject);
  const [name, setName] = useState("");

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listFn(),
  });

  const create = useMutation({
    mutationFn: (n: string) => createFn({ data: { name: n } }),
    onSuccess: (row) => {
      setName("");
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate({ to: "/projects/$id", params: { id: row.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="container mx-auto max-w-5xl pb-12">
      <TopTabs />
      <div className="px-6 pt-8">
      {/* Hero */}
      <section className="text-center mb-12 animate-fade-in">
        <h1 className="font-serif text-5xl md:text-6xl tracking-tight">Projekty</h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Wybierz istniejący projekt lub stwórz nowy, aby zacząć wzbogacać dane produktowe.
        </p>
      </section>

      {/* Prompt-bar */}
      <form
        className="mx-auto max-w-3xl rounded-3xl bg-card/70 backdrop-blur-xl border border-border/50 shadow-lg p-3 flex items-center gap-2 animate-scale-in"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <Input
          placeholder="Nazwij nowy projekt, np. „Broń Q1 2026”…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="flex-1 h-12 rounded-2xl border-0 bg-transparent focus-visible:ring-0 text-base px-4"
        />
        <Button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-full h-12 px-6 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Sparkles className="h-4 w-4 mr-2" /> Stwórz projekt
        </Button>
      </form>

      {/* Lista */}
      <section className="mt-12">
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="font-serif text-2xl">Ostatnie projekty</h2>
          {projects.length > 0 && (
            <span className="text-xs text-muted-foreground">{projects.length} łącznie</span>
          )}
        </div>

        {isLoading ? (
          <p className="text-muted-foreground px-1">Ładowanie…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/60 p-12 text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-primary/15 flex items-center justify-center">
              <Plus className="h-5 w-5 text-primary" />
            </div>
            <p className="text-muted-foreground">Brak projektów. Stwórz pierwszy powyżej.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {projects.map((p, idx) => {
              const accents = ["bg-primary", "bg-accent", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
              const dot = accents[idx % accents.length];
              return (
                <div
                  key={p.id}
                  className="group relative rounded-3xl bg-card/60 backdrop-blur-sm border border-border/50 p-5 hover-lift transition-all"
                >
                  <span className={`absolute top-5 right-5 h-3 w-3 rounded-full ${dot}`} />
                  <div className="flex items-center gap-2 pr-6">
                    <h3 className="font-serif text-xl truncate">{p.name}</h3>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-widest border-border/60">
                      {p.strategy}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString("pl-PL")}
                    </span>
                  </div>
                  <div className="mt-5 flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Usunąć projekt "${p.name}"? Wszystkie dane przepadną.`))
                          del.mutate(p.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button asChild className="rounded-full px-5">
                      <Link to="/projects/$id" params={{ id: p.id }}>
                        Otwórz <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
