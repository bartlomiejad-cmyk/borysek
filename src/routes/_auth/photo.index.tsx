import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listPhotoProjects,
  createPhotoProject,
  deletePhotoProject,
} from "@/lib/photo-tool/photo-tool.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowRight, Camera } from "lucide-react";
import { toast } from "sonner";
import { TopTabs } from "@/components/TopTabs";

export const Route = createFileRoute("/_auth/photo/")({ component: PhotoIndexPage });

function PhotoIndexPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listPhotoProjects);
  const createFn = useServerFn(createPhotoProject);
  const delFn = useServerFn(deletePhotoProject);
  const [name, setName] = useState("");

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["photo-projects"],
    queryFn: () => listFn(),
  });

  const create = useMutation({
    mutationFn: (n: string) => createFn({ data: { name: n } }),
    onSuccess: (row) => {
      setName("");
      qc.invalidateQueries({ queryKey: ["photo-projects"] });
      navigate({ to: "/photo/$id", params: { id: row.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo-projects"] }),
  });

  return (
    <div className="container mx-auto max-w-5xl pb-12">
      <TopTabs />
      <div className="px-6 pt-8">
        <section className="text-center mb-10 animate-fade-in">
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight">Zdjęcia</h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Wygeneruj miniaturkę produktu (packshot na białym tle) oraz realistyczne
            wizualizacje w wymiarze 2K, w oparciu o zdjęcie źródłowe i opis produktu.
            Model: Google Nano Banana Pro (fal.ai).
          </p>
        </section>

        <form
          className="mx-auto max-w-3xl rounded-3xl bg-card/70 backdrop-blur-xl border border-border/50 shadow-lg p-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim());
          }}
        >
          <Input
            placeholder="Nazwij projekt zdjęciowy, np. „Kampania jesień”…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="flex-1 h-12 rounded-2xl border-0 bg-transparent focus-visible:ring-0 text-base px-4"
          />
          <Button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="rounded-full h-12 px-6"
          >
            <Camera className="h-4 w-4 mr-2" /> Stwórz projekt
          </Button>
        </form>

        <section className="mt-10">
          <div className="flex items-center justify-between mb-4 px-1">
            <h2 className="font-serif text-2xl">Twoje projekty zdjęciowe</h2>
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
              <p className="text-muted-foreground">
                Brak projektów zdjęciowych. Stwórz pierwszy powyżej.
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="group relative rounded-3xl bg-card/60 backdrop-blur-sm border border-border/50 p-5 hover-lift transition-all"
                >
                  <h3 className="font-serif text-xl truncate pr-6">{p.name}</h3>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-widest border-border/60">
                      {p.variants_per_product} wizualizacji / produkt
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
                        if (confirm(`Usunąć projekt "${p.name}"? Wszystkie zdjęcia przepadną.`))
                          del.mutate(p.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button asChild className="rounded-full px-5">
                      <Link to="/photo/$id" params={{ id: p.id }}>
                        Otwórz <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}