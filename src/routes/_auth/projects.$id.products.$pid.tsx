import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getProductDetail, updateGoldenRecord } from "@/lib/pim/queries.functions";
import { getActiveBulkJob } from "@/lib/pim/bulk-jobs.functions";
import { generateGoldenRecord, generateFeatures, verifyProduct, analyzeProductImages } from "@/lib/pim/ai.functions";
import { generateAllegroDescription } from "@/lib/pim/ai.functions";
import { hideImage, unhideImage, updateFeatures } from "@/lib/pim/enrichments.functions";
import { setPinnedMainImage, removeGalleryUrl } from "@/lib/pim/enrichments.functions";
import { regenerateMainImage, clearRegeneratedImage } from "@/lib/pim/regen.functions";
import { recleanProductSources } from "@/lib/pim/firecrawl.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn, friendlyError } from "@/lib/utils";
import { ArrowLeft, Sparkles, Save, ExternalLink, RefreshCw, ImageOff, Trash2, ListPlus, ShieldCheck, Plus, Undo2, AlertTriangle, Loader2, Crown, Wand2, Pin, PinOff, Eraser, Eye } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export const Route = createFileRoute("/_auth/projects/$id/products/$pid")({
  component: ProductDetail,
});

type ImgScore = { is_central: number; is_clean: number; has_packaging?: number; is_banner_or_trash: boolean };
type ImgMeta = { w: number; h: number };

function scoreToneClass(n: number): string {
  if (n >= 8) return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-400";
  if (n >= 5) return "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-400";
  return "bg-destructive/15 text-destructive border-destructive/40";
}

function ProductDetail() {
  const { id, pid } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getProductDetail);
  const getActiveJobFn = useServerFn(getActiveBulkJob);
  const genFn = useServerFn(generateGoldenRecord);
  const updFn = useServerFn(updateGoldenRecord);
  const genFeatFn = useServerFn(generateFeatures);
  const verifyFn = useServerFn(verifyProduct);
  const hideFn = useServerFn(hideImage);
  const unhideFn = useServerFn(unhideImage);
  const updFeatFn = useServerFn(updateFeatures);
  const analyzeFn = useServerFn(analyzeProductImages);
  const genAllegroFn = useServerFn(generateAllegroDescription);
  const regenFn = useServerFn(regenerateMainImage);
  const clearRegenFn = useServerFn(clearRegeneratedImage);
  const pinFn = useServerFn(setPinnedMainImage);
  const removeGalleryFn = useServerFn(removeGalleryUrl);
  const recleanFn = useServerFn(recleanProductSources);
  const reclean = useMutation({
    mutationFn: () => recleanFn({ data: { projectId: id } }),
    onSuccess: (res) => {
      if (res.updated === 0 && res.imagesRemoved === 0 && res.charsRemoved === 0) {
        toast.info(`Sprawdzono ${res.scanned} źródeł — nic do usunięcia.`);
      } else {
        toast.success(
          `Wyczyszczono ${res.updated}/${res.scanned} źródeł — ${res.imagesRemoved} zdjęć i ${res.charsRemoved} znaków usunięto.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["product", id, pid] });
      qc.invalidateQueries({ queryKey: ["project", id, "products"] });
    },
    onError: (e) => toast.error(friendlyError(e, "Nie udało się wyczyścić źródeł")),
  });

  const { data: vizJob } = useQuery({
    queryKey: ["project", id, "bulk-job", "PIM_VISUALIZATIONS"],
    queryFn: () => getActiveJobFn({ data: { projectId: id, kind: "PIM_VISUALIZATIONS" } }),
    refetchInterval: 3000,
  });
  const vizActive = vizJob && (vizJob.status === "PENDING" || vizJob.status === "PROCESSING");

  const { data, isLoading } = useQuery({
    queryKey: ["product", id, pid],
    queryFn: () => getFn({ data: { projectId: id, productId: pid } }),
    refetchInterval: vizActive ? 5000 : false,
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [features, setFeatures] = useState<Array<{ key: string; value: string }>>([]);
  const [slug, setSlug] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  const [seoKeywords, setSeoKeywords] = useState("");
  const [allegroHtml, setAllegroHtml] = useState("");
  const [allegroGenAt, setAllegroGenAt] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});
  const analyzedKeyRef = useRef<string>("");

  useEffect(() => {
    if (data?.enrichment) {
      setName(data.enrichment.golden_name ?? "");
      setDesc(data.enrichment.golden_description ?? "");
      const f = (data.enrichment as unknown as { golden_features?: Array<{ key: string; value: string }> }).golden_features;
      setFeatures(Array.isArray(f) ? f : []);
      const en = data.enrichment as unknown as {
        golden_slug?: string | null;
        golden_meta_description?: string | null;
        golden_seo_keywords?: string[] | null;
      };
      setSlug(en.golden_slug ?? "");
      setMetaDesc(en.golden_meta_description ?? "");
      setSeoKeywords(Array.isArray(en.golden_seo_keywords) ? en.golden_seo_keywords.join(", ") : "");
      const en2 = data.enrichment as unknown as {
        allegro_description?: string | null;
        allegro_generated_at?: string | null;
      };
      setAllegroHtml(en2.allegro_description ?? "");
      setAllegroGenAt(en2.allegro_generated_at ?? null);
    }
  }, [data?.enrichment]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["product", id, pid] });
    qc.invalidateQueries({ queryKey: ["project", id, "products"] });
  };

  // Derive top-4 visible images and trigger AI scoring for missing ones.
  const imageMeta = (((data as { image_meta?: Record<string, ImgMeta> } | undefined)?.image_meta) ?? {}) as Record<string, ImgMeta>;
  const imageScores = (((data as { image_scores?: Record<string, ImgScore> } | undefined)?.image_scores) ?? {}) as Record<string, ImgScore>;

  const allVisible: string[] = [];
  const regenUrlEarly = (((data as { enrichment?: { regenerated_main_image?: string | null } } | undefined)?.enrichment?.regenerated_main_image) ?? null) as string | null;
  if (regenUrlEarly) allVisible.push(regenUrlEarly);
  if (data?.sources) {
    for (const s of data.sources) {
      for (const u of s.images) if (!allVisible.includes(u)) allVisible.push(u);
      for (const u of s.extra_images) if (!allVisible.includes(u)) allVisible.push(u);
    }
  }
  const top4 = [...allVisible]
    .sort((a, b) => {
      const am = imageMeta[a]; const bm = imageMeta[b];
      return ((bm?.w ?? 0) * (bm?.h ?? 0)) - ((am?.w ?? 0) * (am?.h ?? 0));
    })
    .slice(0, 4);

  useEffect(() => {
    if (!data) return;
    const missing = top4.filter((u) => !imageScores[u]);
    if (!missing.length) return;
    const key = `${pid}|${missing.join("|")}`;
    if (analyzedKeyRef.current === key) return;
    analyzedKeyRef.current = key;
    let cancelled = false;
    setAnalyzing(true);
    setAiUnavailable(false);
    analyzeFn({ data: { productId: pid, urls: missing } })
      .then(() => { if (!cancelled) qc.invalidateQueries({ queryKey: ["product", id, pid] }); })
      .catch(() => { if (!cancelled) setAiUnavailable(true); })
      .finally(() => { if (!cancelled) setAnalyzing(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, top4.join("|")]);

  const scoreFor = (url: string): number => {
    const m = imageMeta[url];
    const area = (m?.w ?? 0) * (m?.h ?? 0);
    const s = imageScores[url];
    // Fallback gdy brak wymiarów (image_meta puste) — oceniaj tylko po AI.
    const effectiveArea = area > 0 ? area : 1;
    if (!s) return area;
    if (s.is_banner_or_trash) return 0;
    const pkg = s.has_packaging ?? 0;
    return (s.is_central + s.is_clean + 1.5 * pkg) * effectiveArea;
  };

  const sortedGlobal = [...allVisible].sort((a, b) => scoreFor(b) - scoreFor(a));
  // Najpierw najlepszy wg rankingu; jeśli ranking nic nie daje, pierwsze niezukrytych zdjęcie ze źródeł.
  const hiddenSet = new Set((((data as { hidden_images?: string[] } | undefined)?.hidden_images) ?? []) as string[]);
  const pinnedMainUrl = (((data as { pinned_main_url?: string | null } | undefined)?.pinned_main_url) ?? null) as string | null;
  const regeneratedMainUrl = regenUrlEarly;
  const autoMainUrl =
    sortedGlobal.find((u) => scoreFor(u) > 0 && !hiddenSet.has(u)) ??
    allVisible.find((u) => !hiddenSet.has(u)) ??
    null;
  const mainUrl =
    (pinnedMainUrl && !hiddenSet.has(pinnedMainUrl) && (allVisible.includes(pinnedMainUrl) || pinnedMainUrl === regeneratedMainUrl))
      ? pinnedMainUrl
      : autoMainUrl;

  const regenAll = useMutation({
    mutationFn: () => genFn({ data: { productId: pid, mode: "all" } }),
    onSuccess: () => {
      toast.success("Złoty rekord wygenerowany");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const regenSingle = useMutation({
    mutationFn: (url: string) =>
      genFn({ data: { productId: pid, mode: "single", singleUrl: url } }),
    onSuccess: () => { toast.success("Wygenerowano z pojedynczego źródła"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const save = useMutation({
    mutationFn: () =>
      updFn({
        data: {
          enrichmentId: data!.enrichment!.id,
          golden_name: name || null,
          golden_description: desc || null,
          golden_slug: slug.trim() || null,
          golden_meta_description: metaDesc.trim() || null,
          golden_seo_keywords: seoKeywords
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => { toast.success("Zapisano"); invalidate(); },
  });

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

  const genAllegro = useMutation({
    mutationFn: () => genAllegroFn({ data: { productId: pid } }),
    onSuccess: (res: { html: string }) => {
      setAllegroHtml(res.html);
      setAllegroGenAt(new Date().toISOString());
      toast.success("Opis Allegro wygenerowany");
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, "Nie udało się wygenerować opisu Allegro")),
  });

  const saveAllegro = useMutation({
    mutationFn: () =>
      updFn({
        data: {
          enrichmentId: data!.enrichment!.id,
          allegro_description: allegroHtml || null,
        } as never,
      }),
    onSuccess: () => { toast.success("Opis Allegro zapisany"); invalidate(); },
    onError: (e) => toast.error(friendlyError(e, "Nie udało się zapisać")),
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

  const regenMut = useMutation({
    mutationFn: (vars: { enrichmentId: string; imageUrl: string }) =>
      regenFn({ data: vars }),
    onSuccess: () => { toast.success("Zdjęcie zregenerowane"); invalidate(); },
    onError: (e) => toast.error(friendlyError(e, "Regeneracja nie powiodła się")),
  });

  const clearRegenMut = useMutation({
    mutationFn: (enrichmentId: string) => clearRegenFn({ data: { enrichmentId } }),
    onSuccess: () => { toast.success("Cofnięto regenerację"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const pinMut = useMutation({
    mutationFn: (vars: { enrichmentId: string; url: string | null }) => pinFn({ data: vars }),
    onSuccess: () => { invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  if (isLoading || !data) return <main className="p-6">Ładowanie...</main>;
  const { product, enrichment, sources } = data;
  const hiddenImages = ((data as { hidden_images?: string[] }).hidden_images ?? []) as string[];
  const includeExtra = (data as { include_extra_images?: boolean }).include_extra_images ?? false;
  const quality = (enrichment as { quality?: { watermark_urls?: string[]; name_mismatch?: boolean; feature_mismatches?: string[]; notes?: string } | null } | null)?.quality ?? null;
  const regeneratedUrl = (enrichment as { regenerated_main_image?: string | null } | null)?.regenerated_main_image ?? null;

  const renderThumb = (u: string, extra: boolean) => {
    const s = imageScores[u];
    const isMain = u === mainUrl;
    const isPinned = u === pinnedMainUrl;
    return (
      <div
        key={u}
        className={cn(
          "relative group rounded border-2 p-0.5",
          isMain ? "border-emerald-500 ring-2 ring-emerald-500/40" : "border-transparent",
        )}
      >
        <img src={u} alt="" className="h-24 w-24 rounded object-cover" />
        {isMain && (
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow flex items-center gap-1">
            <Crown className="h-2.5 w-2.5" /> Główne{isPinned ? " (przypięte)" : ""}
          </span>
        )}
        {extra && <Badge variant="outline" className="absolute top-0 left-0 text-[10px] px-1 py-0">extra</Badge>}
        {enrichment && (
          <button
            onClick={() =>
              pinMut.mutate({
                enrichmentId: enrichment.id,
                url: isPinned ? null : u,
              })
            }
            className={cn(
              "absolute bottom-0 left-0 rounded p-0.5 transition opacity-0 group-hover:opacity-100",
              isPinned ? "bg-emerald-600 text-white opacity-100" : "bg-background/90 border",
            )}
            title={isPinned ? "Odepnij zdjęcie główne" : "Ustaw jako główne"}
          >
            {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>
        )}
        <button
          onClick={() => hideMut.mutate(u)}
          className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded p-0.5 opacity-0 group-hover:opacity-100 transition"
          title="Ukryj zdjęcie"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        <div className="mt-1 flex flex-wrap gap-0.5 justify-center">
          {s ? (
            s.is_banner_or_trash ? (
              <span className="text-[10px] px-1 py-0 rounded border bg-destructive/15 text-destructive border-destructive/40">
                Baner / śmieć
              </span>
            ) : (
              <>
                <span className={cn("text-[10px] px-1 py-0 rounded border", scoreToneClass(s.is_central))} title="Centralność produktu">
                  C {s.is_central}/10
                </span>
                <span className={cn("text-[10px] px-1 py-0 rounded border", scoreToneClass(s.is_clean))} title="Czystość tła">
                  T {s.is_clean}/10
                </span>
                {typeof s.has_packaging === "number" && (
                  <span className={cn("text-[10px] px-1 py-0 rounded border", scoreToneClass(s.has_packaging))} title="Pudełko + produkt razem">
                    P {s.has_packaging}/10
                  </span>
                )}
              </>
            )
          ) : top4.includes(u) && analyzing ? (
            <span className="text-[10px] px-1 py-0 rounded border bg-muted text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> AI…
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <main className="container mx-auto p-6 max-w-7xl">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/projects/$id" params={{ id }}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Wróć do projektu
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">{product.nazwa}</h1>
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
        <div className="flex gap-2">
        <Button asChild variant="outline" title="Otwórz podgląd karty produktu na podstawie złotego rekordu — dobre do demo dla klienta">
          <Link to="/projects/$id/products/$pid/preview" params={{ id, pid }} target="_blank" rel="noopener noreferrer">
            <Eye className="h-4 w-4 mr-2" />
            Podgląd karty
          </Link>
        </Button>
        <Button
          variant="outline"
          title="Usuwa logo metod płatności, ikony kontaktu, stopki i bloki adresu sklepu z zapisanych źródeł. Bezpieczne, bez kosztu Firecrawl."
          disabled={reclean.isPending}
          onClick={() => reclean.mutate()}
        >
          {reclean.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Eraser className="h-4 w-4 mr-2" />
          )}
          {reclean.isPending ? "Czyszczenie…" : "Wyczyść źródła"}
        </Button>
        <Button
          onClick={() => regenAll.mutate()}
          disabled={regenAll.isPending || sources.length === 0}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {regenAll.isPending ? "Generowanie..." : "Generuj z 3 źródeł"}
        </Button>
        </div>
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
            {/* Regeneracja zdjęcia głównego przez FAL.ai */}
            <div className="rounded border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1">
                    <Wand2 className="h-3.5 w-3.5 text-violet-500" /> Zdjęcie główne (FAL.ai)
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Białe tło, miękki cień, produkt ~70% kadru, JPG 2560×2560.
                  </p>
                </div>
                <div className="flex gap-1">
                  {regeneratedUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!enrichment}
                      onClick={() => {
                        if (!enrichment) return;
                        clearRegenMut.mutate(enrichment.id);
                      }}
                    >
                      <Undo2 className="h-3 w-3 mr-1" /> Cofnij
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!enrichment || !mainUrl || regenMut.isPending}
                    onClick={() => {
                      if (!enrichment || !mainUrl) return;
                      regenMut.mutate({ enrichmentId: enrichment.id, imageUrl: mainUrl });
                    }}
                  >
                    {regenMut.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3 mr-1" />
                    )}
                    {regenMut.isPending ? "Generuję…" : regeneratedUrl ? "Regeneruj ponownie" : "Regeneruj"}
                  </Button>
                </div>
              </div>
              {regenMut.isPending && (
                <p className="text-[11px] text-muted-foreground italic">
                  Generuję zdjęcie produktowe… (10–40 s)
                </p>
              )}
              {regeneratedUrl && (
                <a href={regeneratedUrl} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={regeneratedUrl}
                    alt="Regenerowane zdjęcie produktu"
                    className="w-full max-h-72 object-contain rounded border bg-white"
                  />
                </a>
              )}
              {!regeneratedUrl && mainUrl && (
                <a href={mainUrl} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={mainUrl}
                    alt="Oryginalne zdjęcie ze źródła"
                    className="w-full max-h-72 object-contain rounded border bg-white"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1 italic">
                    Oryginał (źródło) — kliknij Regeneruj, aby przerobić na czystą miniaturę.
                  </p>
                </a>
              )}
              {!mainUrl && !regeneratedUrl && (
                <p className="text-[11px] text-muted-foreground italic">
                  Brak zdjęcia głównego do regeneracji.
                </p>
              )}
            </div>

            {/* Galeria wybranych zdjęć ze wszystkich dopasowanych źródeł */}
            <div className="rounded border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Wybrane zdjęcia</p>
                <p className="text-[11px] text-muted-foreground">
                  {allVisible.filter((u) => !hiddenSet.has(u)).length} widocznych
                  {hiddenImages.length ? ` · ${hiddenImages.length} ukrytych` : ""}
                </p>
              </div>
              {(() => {
                const visible = allVisible.filter((u) => !hiddenSet.has(u));
                const sorted = [...visible].sort((a, b) => {
                  if (a === mainUrl) return -1;
                  if (b === mainUrl) return 1;
                  return scoreFor(b) - scoreFor(a);
                });
                if (!sorted.length) {
                  return (
                    <p className="text-[11px] text-muted-foreground italic">
                      Brak zdjęć z dopasowanych źródeł.
                    </p>
                  );
                }
                const extraSet = new Set<string>();
                for (const s of sources ?? []) for (const u of s.extra_images) extraSet.add(u);
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {sorted.map((u) => renderThumb(u, extraSet.has(u)))}
                  </div>
                );
              })()}
              {hiddenImages.length > 0 && (
                <details className="pt-1">
                  <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                    Pokaż ukryte ({hiddenImages.length})
                  </summary>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 opacity-60">
                    {hiddenImages.map((u) => (
                      <div key={u} className="relative group rounded border p-0.5">
                        <img src={u} alt="" className="h-24 w-24 rounded object-cover grayscale" />
                        <button
                          onClick={() => unhideMut.mutate(u)}
                          className="absolute top-0 right-0 bg-background border rounded p-0.5 opacity-0 group-hover:opacity-100 transition"
                          title="Przywróć"
                        >
                          <Undo2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            {/* Wizualizacje AI (lifestyle) */}
            {(() => {
              const gallery = (((enrichment as { ai_gallery_urls?: string[] | null } | null)?.ai_gallery_urls) ?? []) as string[];
              if (!gallery.length) return null;
              return (
                <div className="rounded border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Wand2 className="h-4 w-4" /> Wizualizacje AI
                    </p>
                    <p className="text-[11px] text-muted-foreground">{gallery.length} obraz(ów)</p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {gallery.map((u) => {
                      const isPinned = u === pinnedMainUrl;
                      return (
                        <div
                          key={u}
                          className={cn(
                            "relative group rounded border-2 p-0.5",
                            isPinned ? "border-emerald-500 ring-2 ring-emerald-500/40" : "border-violet-400/60",
                          )}
                        >
                          <a href={u} target="_blank" rel="noreferrer">
                            <img src={u} alt="" className="h-24 w-24 rounded object-cover" />
                          </a>
                          <Badge
                            variant="outline"
                            className="absolute top-0 left-0 text-[10px] px-1 py-0 bg-violet-500/10 text-violet-700 border-violet-400/50 dark:text-violet-300"
                          >
                            AI
                          </Badge>
                          {enrichment && (
                            <button
                              onClick={() =>
                                pinMut.mutate({
                                  enrichmentId: enrichment.id,
                                  url: isPinned ? null : u,
                                })
                              }
                              className={cn(
                                "absolute bottom-0 left-0 rounded p-0.5 transition opacity-0 group-hover:opacity-100",
                                isPinned ? "bg-emerald-600 text-white opacity-100" : "bg-background/90 border",
                              )}
                              title={isPinned ? "Odepnij" : "Ustaw jako główne"}
                            >
                              {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              if (!enrichment) return;
                              try {
                                await removeGalleryFn({ data: { enrichmentId: enrichment.id, url: u } });
                                toast.success("Wizualizacja usunięta");
                                invalidate();
                              } catch (e) {
                                toast.error(friendlyError(e, "Nie udało się usunąć"));
                              }
                            }}
                            className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded p-0.5 opacity-0 group-hover:opacity-100 transition"
                            title="Usuń wizualizację"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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
                placeholder="Wygeneruj opis lub wpisz ręcznie (HTML: <h3>, <p>, <ul>, <li>, <strong>)..."
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">{desc.length} znaków</p>
              {desc.trim() && (
                <details className="mt-2 rounded border bg-muted/20 p-2 text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Podgląd HTML</summary>
                  <div
                    className="mt-2 text-sm [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-0 [&_h3]:mb-2 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: desc }}
                  />
                </details>
              )}
            </div>
            <div className="space-y-3 rounded border bg-muted/30 p-3">
              <p className="text-sm font-medium">SEO</p>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Slug (URL)</label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="np. brand-model-typ"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Kebab-case, bez polskich znaków, maks. 75. {slug.length} znaków.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Meta description</label>
                <Textarea
                  value={metaDesc}
                  onChange={(e) => setMetaDesc(e.target.value)}
                  rows={3}
                  placeholder="150–160 znaków, jedno zdanie sprzedażowe z nazwą produktu."
                />
                <p
                  className={cn(
                    "text-[11px] mt-1",
                    metaDesc.length > 160 || (metaDesc.length > 0 && metaDesc.length < 120)
                      ? "text-amber-600"
                      : "text-muted-foreground",
                  )}
                >
                  {metaDesc.length} / 160 znaków (zalecane 150–160)
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">SEO keywords</label>
                <Input
                  value={seoKeywords}
                  onChange={(e) => setSeoKeywords(e.target.value)}
                  placeholder="frazy oddzielone przecinkami"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  3–8 fraz: główna + long-tail. Oddziel przecinkami.
                </p>
              </div>
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

            {/* Allegro description */}
            <div className="pt-4 border-t mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  Opis Allegro {allegroGenAt && (
                    <span className="ml-1 text-[10px] italic">
                      · wygenerowano {new Date(allegroGenAt).toLocaleString("pl-PL")}
                    </span>
                  )}
                </label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!enrichment || genAllegro.isPending}
                    onClick={() => genAllegro.mutate()}
                  >
                    <Sparkles className="h-3 w-3 mr-1" /> {genAllegro.isPending ? "..." : "Generuj Allegro"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!allegroHtml}
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(allegroHtml); toast.success("Skopiowano HTML"); }
                      catch { toast.error("Nie udało się skopiować"); }
                    }}
                  >
                    Kopiuj HTML
                  </Button>
                </div>
              </div>
              <Textarea
                value={allegroHtml}
                onChange={(e) => setAllegroHtml(e.target.value)}
                rows={16}
                placeholder='HTML opisu Allegro (h1/h2/h3, p, ul/li, strong). Kliknij "Generuj Allegro".'
                className="font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  {allegroHtml.replace(/<[^>]+>/g, "").length} znaków widocznego tekstu · {allegroHtml.length} z HTML
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!enrichment || saveAllegro.isPending}
                  onClick={() => saveAllegro.mutate()}
                >
                  <Save className="h-3 w-3 mr-1" /> Zapisz Allegro
                </Button>
              </div>
              {allegroHtml.trim() && (
                <details className="mt-2 rounded border bg-muted/20 p-2 text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Podgląd</summary>
                  <div
                    className="mt-2 text-sm [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-0 [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: allegroHtml }}
                  />
                </details>
              )}
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
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold flex items-center gap-2">
              Źródła ({sources.length})
            </h2>
            <div className="flex items-center gap-2">
              {analyzing && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> AI analizuje…
                </span>
              )}
              {!analyzing && aiUnavailable && (
                <span className="text-xs text-muted-foreground">Sort po rozdzielczości</span>
              )}
              {sources.length > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-full h-7 px-3 text-xs"
                    onClick={() => setOpenSources(Object.fromEntries(sources.map((s) => [s.url, true])))}
                  >
                    Rozwiń
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-full h-7 px-3 text-xs"
                    onClick={() => setOpenSources({})}
                  >
                    Zwiń
                  </Button>
                </>
              )}
            </div>
          </div>
          {sources.length === 0 && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">
              Brak dopasowanych źródeł. Sprawdź pliki Search/Product JSON i uruchom dopasowanie.
            </CardContent></Card>
          )}
          {sources.map((s, i) => {
            const combined = [
              ...s.images.map((u) => ({ u, extra: false })),
              ...s.extra_images.map((u) => ({ u, extra: true })),
            ].sort((a, b) => scoreFor(b.u) - scoreFor(a.u));
            const isOpen = openSources[s.url] ?? i === 0;
            const headThumb = combined[0]?.u;
            return (
              <Card key={s.url} className="overflow-hidden">
                <Collapsible
                  open={isOpen}
                  onOpenChange={(o) => setOpenSources((m) => ({ ...m, [s.url]: o }))}
                >
                  <CollapsibleTrigger asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpenSources((m) => ({ ...m, [s.url]: !isOpen }));
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                    >
                      {headThumb ? (
                        <img
                          src={headThumb}
                          alt=""
                          loading="lazy"
                          className="h-12 w-12 rounded-xl object-cover bg-muted shrink-0"
                        />
                      ) : (
                        <span className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
                          <ImageOff className="h-4 w-4 text-muted-foreground" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          <span className="text-muted-foreground mr-2">#{i + 1}</span>
                          {s.title ?? "(brak tytułu)"}
                        </div>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="text-xs text-muted-foreground inline-flex items-center gap-1 truncate max-w-full hover:text-foreground hover:underline relative z-10"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{s.url}</span>
                        </a>
                      </div>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
                        {combined.length} zdj.
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                          isOpen && "rotate-180",
                        )}
                      />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-3 pt-0">
                      {combined.length > 0 ? (
                        <div className="flex flex-wrap gap-3">
                          {combined.map(({ u, extra }) => renderThumb(u, extra))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <ImageOff className="h-3 w-3" /> brak zdjęć{!includeExtra ? " (extra wyłączone)" : ""}
                        </div>
                      )}
                      <div className="text-sm whitespace-pre-wrap max-h-64 overflow-auto border border-border/50 rounded-2xl p-3 bg-muted/30">
                        {s.description ?? "(brak opisu)"}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        disabled={regenSingle.isPending}
                        onClick={() => regenSingle.mutate(s.url)}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Regeneruj tylko z tego źródła
                      </Button>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );
}