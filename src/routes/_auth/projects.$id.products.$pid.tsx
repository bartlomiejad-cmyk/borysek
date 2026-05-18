import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getProductDetail, updateGoldenRecord } from "@/lib/pim/queries.functions";
import { generateGoldenRecord } from "@/lib/pim/ai.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Sparkles, Save, ExternalLink, RefreshCw, ImageOff } from "lucide-react";

export const Route = createFileRoute("/_auth/projects/$id/products/$pid")({
  component: ProductDetail,
});

function ProductDetail() {
  const { id, pid } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getProductDetail);
  const genFn = useServerFn(generateGoldenRecord);
  const updFn = useServerFn(updateGoldenRecord);

  const { data, isLoading } = useQuery({
    queryKey: ["product", id, pid],
    queryFn: () => getFn({ data: { projectId: id, productId: pid } }),
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (data?.enrichment) {
      setName(data.enrichment.golden_name ?? "");
      setDesc(data.enrichment.golden_description ?? "");
    }
  }, [data?.enrichment]);

  const regenAll = useMutation({
    mutationFn: () => genFn({ data: { productId: pid, mode: "all" } }),
    onSuccess: () => {
      toast.success("Złoty rekord wygenerowany");
      qc.invalidateQueries({ queryKey: ["product", id, pid] });
      qc.invalidateQueries({ queryKey: ["project", id, "products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const regenSingle = useMutation({
    mutationFn: (url: string) =>
      genFn({ data: { productId: pid, mode: "single", singleUrl: url } }),
    onSuccess: () => {
      toast.success("Wygenerowano z pojedynczego źródła");
      qc.invalidateQueries({ queryKey: ["product", id, pid] });
      qc.invalidateQueries({ queryKey: ["project", id, "products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const save = useMutation({
    mutationFn: () =>
      updFn({
        data: {
          enrichmentId: data!.enrichment!.id,
          golden_name: name || null,
          golden_description: desc || null,
        },
      }),
    onSuccess: () => {
      toast.success("Zapisano");
      qc.invalidateQueries({ queryKey: ["product", id, pid] });
    },
  });

  if (isLoading || !data) return <main className="p-6">Ładowanie...</main>;
  const { product, enrichment, sources } = data;

  return (
    <main className="container mx-auto p-6 max-w-7xl">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/projects/$id" params={{ id }}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Wróć do projektu
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{product.nazwa}</h1>
          <p className="text-sm text-muted-foreground">
            EAN: {product.ean ?? "—"} · Kod: {product.kod ?? "—"} · ID: {product.ext_id ?? "—"}
          </p>
          {enrichment && (
            <div className="mt-2 flex gap-2">
              <Badge variant="outline">{enrichment.match_type}</Badge>
              <Badge>{enrichment.status}</Badge>
              {enrichment.model && (
                <span className="text-xs text-muted-foreground self-center">{enrichment.model}</span>
              )}
            </div>
          )}
        </div>
        <Button
          onClick={() => regenAll.mutate()}
          disabled={regenAll.isPending || sources.length === 0}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {regenAll.isPending ? "Generowanie..." : "Generuj z 3 źródeł"}
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Golden record */}
        <Card className="lg:sticky lg:top-4 self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" /> Złoty Rekord
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nazwa</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wygeneruj lub wpisz nazwę" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Opis</label>
              <Textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={20}
                placeholder="Wygeneruj opis lub wpisz ręcznie..."
              />
              <p className="text-xs text-muted-foreground mt-1">{desc.length} znaków</p>
            </div>
            <Button onClick={() => save.mutate()} disabled={!enrichment || save.isPending}>
              <Save className="h-4 w-4 mr-2" /> Zapisz
            </Button>
            {enrichment?.error && (
              <p className="text-xs text-destructive">Błąd ostatniej generacji: {enrichment.error}</p>
            )}
          </CardContent>
        </Card>

        {/* Sources */}
        <div className="space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            Źródła ({sources.length})
          </h2>
          {sources.length === 0 && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">
              Brak dopasowanych źródeł. Sprawdź pliki Search/Product JSON i uruchom dopasowanie.
            </CardContent></Card>
          )}
          {sources.map((s, i) => (
            <Card key={s.url}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      <span className="text-muted-foreground mr-2">#{i + 1}</span>
                      {s.title ?? "(brak tytułu)"}
                    </CardTitle>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 truncate max-w-full"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{s.url}</span>
                    </a>
                  </div>
                  {s.images[0] ? (
                    <img src={s.images[0]} alt="" className="h-16 w-16 rounded border object-cover shrink-0" />
                  ) : (
                    <div className="h-16 w-16 rounded border bg-muted flex items-center justify-center shrink-0">
                      <ImageOff className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm whitespace-pre-wrap max-h-64 overflow-auto border rounded p-2 bg-muted/30">
                  {s.description ?? "(brak opisu)"}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={regenSingle.isPending}
                  onClick={() => regenSingle.mutate(s.url)}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regeneruj tylko z tego źródła
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}