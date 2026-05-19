import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listProductsWithEnrichment } from "@/lib/pim/queries.functions";
import { verifyProduct } from "@/lib/pim/ai.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ShieldCheck, ImageOff, AlertTriangle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_auth/projects/verify")({ component: VerifyPage });

const CONCURRENCY = 3;

function VerifyPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const listFn = useServerFn(listProductsWithEnrichment);
  const verifyFn = useServerFn(verifyProduct);

  const { data: products = [] } = useQuery({
    queryKey: ["project", id, "products"],
    queryFn: () => listFn({ data: { projectId: id } }),
  });

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const verifyOne = useMutation({
    mutationFn: (pid: string) => verifyFn({ data: { productId: pid } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id, "products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const verifyAll = async () => {
    const targets = products.filter((p) => p.status === "GENERATED");
    if (!targets.length) return toast.info("Brak wygenerowanych produktów");
    setProgress({ done: 0, total: targets.length });
    let done = 0;
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        if (!p) break;
        try { await verifyFn({ data: { productId: p.id } }); } catch { /* skip */ }
        done++;
        setProgress({ done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setProgress(null);
    qc.invalidateQueries({ queryKey: ["project", id, "products"] });
    toast.success("Weryfikacja zakończona");
  };

  const visible = onlyProblems
    ? products.filter((p) => {
        const q = p.quality;
        return q && ((q.watermark_urls?.length ?? 0) > 0 || q.name_mismatch || (q.feature_mismatches?.length ?? 0) > 0);
      })
    : products;

  return (
    <main className="container mx-auto p-6 max-w-7xl">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/projects/$id" params={{ id }}><ArrowLeft className="h-4 w-4 mr-2" /> Wróć</Link>
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">Widok weryfikacyjny</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setOnlyProblems((v) => !v)}>
            {onlyProblems ? "Pokaż wszystkie" : "Tylko z problemami"}
          </Button>
          <Button onClick={verifyAll} disabled={!!progress}>
            <ShieldCheck className="h-4 w-4 mr-2" /> Sprawdź wszystkie AI
          </Button>
        </div>
      </div>

      {progress && (
        <Card className="mb-4"><CardContent className="py-3">
          <div className="flex justify-between text-sm mb-2">
            <span>Weryfikacja {progress.done}/{progress.total}</span>
            <span className="text-muted-foreground">{Math.round((progress.done / progress.total) * 100)}%</span>
          </div>
          <Progress value={(progress.done / progress.total) * 100} />
        </CardContent></Card>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((p) => {
          const q = p.quality;
          const hasProblems = q && ((q.watermark_urls?.length ?? 0) > 0 || q.name_mismatch || (q.feature_mismatches?.length ?? 0) > 0);
          return (
            <Card key={p.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between gap-2">
                  <Link
                    to="/projects/$id/products/$pid"
                    params={{ id, pid: p.id }}
                    className="font-medium line-clamp-2 hover:underline"
                  >
                    {p.golden_name ?? p.nazwa ?? "—"}
                  </Link>
                  {q == null ? (
                    <Badge variant="outline">brak QA</Badge>
                  ) : hasProblems ? (
                    <Badge variant="destructive" className="shrink-0"><AlertTriangle className="h-3 w-3 mr-1" />problem</Badge>
                  ) : (
                    <Badge className="bg-green-600 shrink-0"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>
                  )}
                </div>
                <div className="flex gap-1">
                  {(p.images ?? []).slice(0, 3).map((u) => (
                    <img key={u} src={u} alt="" loading="lazy" className="h-16 w-16 object-cover rounded border" />
                  ))}
                  {!(p.images?.length) && (
                    <div className="h-16 w-16 rounded border bg-muted flex items-center justify-center">
                      <ImageOff className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                {p.golden_features?.length ? (
                  <div className="text-xs space-y-0.5">
                    {p.golden_features.slice(0, 4).map((f, i) => (
                      <div key={i}><span className="text-muted-foreground">{f.key}:</span> {f.value}</div>
                    ))}
                  </div>
                ) : null}
                {q && (
                  <div className="text-xs space-y-1 border-t pt-2">
                    {q.name_mismatch && <div className="text-destructive">⚠ Zdjęcia nie pasują do nazwy</div>}
                    {(q.watermark_urls?.length ?? 0) > 0 && (
                      <div className="text-destructive">⚠ Znak wodny: {q.watermark_urls!.length} zdj.</div>
                    )}
                    {(q.feature_mismatches?.length ?? 0) > 0 && (
                      <div className="text-destructive">⚠ Cechy: {q.feature_mismatches!.join(", ")}</div>
                    )}
                    {q.notes && <div className="text-muted-foreground line-clamp-2">{q.notes}</div>}
                  </div>
                )}
                <Button size="sm" variant="outline" disabled={verifyOne.isPending} onClick={() => verifyOne.mutate(p.id)}>
                  <ShieldCheck className="h-4 w-4 mr-1" /> Sprawdź AI
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
