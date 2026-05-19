import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getProductDetail, updateGoldenRecord } from "@/lib/pim/queries.functions";
import { generateGoldenRecord, generateFeatures, verifyProduct } from "@/lib/pim/ai.functions";
import { hideImage, unhideImage, updateFeatures } from "@/lib/pim/enrichments.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Sparkles, Save, ExternalLink, RefreshCw, ImageOff, Trash2, ListPlus, ShieldCheck, Plus, Undo2, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_auth/projects/$id/products/$pid")({
  component: ProductDetail,
});

function ProductDetail() {
  const { id, pid } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getProductDetail);
  const genFn = useServerFn(generateGoldenRecord);
  const updFn = useServerFn(updateGoldenRecord);
  const genFeatFn = useServerFn(generateFeatures);
  const verifyFn = useServerFn(verifyProduct);
  const hideFn = useServerFn(hideImage);
  const unhideFn = useServerFn(unhideImage);
  const updFeatFn = useServerFn(updateFeatures);

  const { data, isLoading } = useQuery({
    queryKey: ["product", id, pid],
    queryFn: () => getFn({ data: { projectId: id, productId: pid } }),
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [features, setFeatures] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    if (data?.enrichment) {
      setName(data.enrichment.golden_name ?? "");
      setDesc(data.enrichment.golden_description ?? "");
      const f = (data.enrichment as unknown as { golden_features?: Array<{ key: string; value: string }> }).golden_features;
      setFeatures(Array.isArray(f) ? f : []);
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["product", id, pid] });
    qc.invalidateQueries({ queryKey: ["project", id, "products"] });
  };

  const genFeat = useMutation({
    mutationFn: () => genFeatFn({ data: { productId: pid } }),
    onSuccess: () => { toast.success("Cechy wygenerowane"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const verify = useMutation({
    mutationFn: () => verifyFn({ data: { productId: pid } }),
    onSuccess: () => { toast.success("Weryfikacja zakończona"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const saveFeat = useMutation({
    mutationFn: () => updFeatFn({ data: { enrichmentId: data!.enrichment!.id, features: features.filter((f) => f.key.trim() && f.value.trim()) } }),
    onSuccess: () => { toast.success("Cechy zapisane"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const hideMut = useMutation({
    mutationFn: (url: string) => hideFn({ data: { enrichmentId: data!.enrichment!.id, url } }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const unhideMut = useMutation({
    mutationFn: (url: string) => unhideFn({ data: { enrichmentId: data!.enrichment!.id, url } }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  if (isLoading || !data) return <main className="p-6">Ładowanie...</main>;
  const { product, enrichment, sources } = data;
  const hiddenImages = ((data as { hidden_images?: string[] }).hidden_images ?? []) as string[];
  const includeExtra = (data as { include_extra_images?: boolean }).include_extra_images ?? false;
  const quality = (enrichment as { quality?: { watermark_urls?: string[]; name_mismatch?: boolean; feature_mismatches?: string[]; notes?: string } | null } | null)?.quality ?? null;

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

            {/* Features editor */}
            <div className="pt-4 border-t mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Cechy ({features.length})</label>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setFeatures([...features, { key: "", value: "" }])}>
                    <Plus className="h-3 w-3 mr-1" /> Dodaj
                  </Button>
                  <Button size="sm" variant="outline" disabled={!enrichment || genFeat.isPending} onClick={() => genFeat.mutate()}>
                    <ListPlus className="h-3 w-3 mr-1" /> {genFeat.isPending ? "..." : "Generuj AI"}
                  </Button>
                </div>
              </div>
              <div className="space-y-1 max-h-72 overflow-auto">
                {features.map((f, idx) => (
                  <div key={idx} className="flex gap-1">
                    <Input value={f.key} onChange={(e) => { const n = [...features]; n[idx] = { ...n[idx], key: e.target.value }; setFeatures(n); }} placeholder="Klucz" className="h-8 text-xs" />
                    <Input value={f.value} onChange={(e) => { const n = [...features]; n[idx] = { ...n[idx], value: e.target.value }; setFeatures(n); }} placeholder="Wartość" className="h-8 text-xs" />
                    <Button size="sm" variant="ghost" onClick={() => setFeatures(features.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {features.length === 0 && <p className="text-xs text-muted-foreground italic">Brak cech.</p>}
              </div>
              <Button size="sm" onClick={() => saveFeat.mutate()} disabled={!enrichment || saveFeat.isPending}>
                <Save className="h-3 w-3 mr-1" /> Zapisz cechy
              </Button>
            </div>

            {/* Verification */}
            <div className="pt-4 border-t mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Weryfikacja AI</label>
                <Button size="sm" variant="outline" disabled={!enrichment || verify.isPending} onClick={() => verify.mutate()}>
                  <ShieldCheck className="h-3 w-3 mr-1" /> {verify.isPending ? "..." : "Sprawdź"}
                </Button>
              </div>
              {quality ? (
                <div className="text-xs space-y-1">
                  {quality.name_mismatch && (
                    <div className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" /> Zdjęcia nie pasują do nazwy</div>
                  )}
                  {!!quality.watermark_urls?.length && (
                    <div className="text-amber-600">⚠ Znak wodny: {quality.watermark_urls.length} zdj.</div>
                  )}
                  {!!quality.feature_mismatches?.length && (
                    <div className="text-amber-600">⚠ Sprzeczne cechy: {quality.feature_mismatches.join(", ")}</div>
                  )}
                  {quality.notes && <p className="text-muted-foreground">{quality.notes}</p>}
                  {!quality.name_mismatch && !quality.watermark_urls?.length && !quality.feature_mismatches?.length && (
                    <div className="text-emerald-600">✓ Brak problemów</div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">Nie sprawdzono.</p>
              )}
            </div>

            {hiddenImages.length > 0 && (
              <div className="pt-4 border-t mt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Ukryte zdjęcia ({hiddenImages.length})</p>
                <div className="flex flex-wrap gap-1">
                  {hiddenImages.map((u) => (
                    <button key={u} onClick={() => unhideMut.mutate(u)} className="relative group" title="Przywróć">
                      <img src={u} alt="" className="h-12 w-12 rounded border object-cover opacity-50" />
                      <Undo2 className="h-3 w-3 absolute top-0 right-0 bg-background rounded" />
                    </button>
                  ))}
                </div>
              </div>
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
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {(s.images.length > 0 || s.extra_images.length > 0) ? (
                  <div className="flex flex-wrap gap-2">
                    {[...s.images.map((u) => ({ u, extra: false })), ...s.extra_images.map((u) => ({ u, extra: true }))].map(({ u, extra }) => (
                      <div key={u} className="relative group">
                        <img src={u} alt="" className="h-20 w-20 rounded border object-cover" />
                        {extra && <Badge variant="outline" className="absolute top-0 left-0 text-[10px] px-1 py-0">extra</Badge>}
                        <button
                          onClick={() => hideMut.mutate(u)}
                          className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded p-0.5 opacity-0 group-hover:opacity-100 transition"
                          title="Ukryj zdjęcie"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground"><ImageOff className="h-3 w-3" /> brak zdjęć{!includeExtra ? " (extra wyłączone)" : ""}</div>
                )}
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