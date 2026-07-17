import { createFileRoute, Link } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getProductDetail, updateGoldenRecord, setImageManualKeep } from "@/lib/pim/queries.functions";
import { getActiveBulkJob } from "@/lib/pim/bulk-jobs.functions";
import { generateGoldenRecord, generateFeatures, verifyProduct, analyzeProductImages, analyzeProductImagesForPrompt, probeVisibleImagesAlive } from "@/lib/pim/ai.functions";
import { generateAllegroDescription } from "@/lib/pim/ai.functions";
import { runAuditForProduct } from "@/lib/pim/audit.functions";
import { approveProduct, unapproveProduct } from "@/lib/pim/review.functions";
import { hideImage, unhideImage, updateFeatures } from "@/lib/pim/enrichments.functions";
import { setPinnedMainImage, removeGalleryUrl } from "@/lib/pim/enrichments.functions";
import { getProductEvents, type ProductEventRow } from "@/lib/pim/product-events.functions";
import {
  regenerateMainImage,
  clearRegeneratedImage,
  acceptThumbnailCandidate,
  rejectThumbnailCandidate,
  saveVizAnalysisOverride,
} from "@/lib/pim/regen.functions";
import {
  recleanProductSources,
  resetProductSources,
  startFirecrawlDiscovery,
} from "@/lib/pim/firecrawl.functions";
import { supabase } from "@/integrations/supabase/client";
import { deleteProducts, updateProductNotes } from "@/lib/pim/products.functions";
import { attachManualSources, setMatchingMode, rerunMatchingForProduct } from "@/lib/pim/compat.functions";
import { removePickedSource } from "@/lib/pim/compat.functions";
import { resolveRegenUrl } from "@/lib/pim/media";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn, friendlyError } from "@/lib/utils";
import { ArrowLeft, Sparkles, Save, ExternalLink, RefreshCw, ImageOff, Trash2, ListPlus, ShieldCheck, Plus, Undo2, AlertTriangle, Loader2, Crown, Wand2, Pin, PinOff, Eraser, Eye, CheckCircle2, X } from "lucide-react";
import { ChevronDown, FileText, History } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export const Route = createFileRoute("/_auth/projects/$id/products/$pid")({
  component: ProductDetail,
});

type ImgScore = {
  is_central: number;
  is_clean: number;
  has_packaging?: number;
  is_banner_or_trash: boolean;
  identity?: "same" | "different" | "unsure";
  manual_keep?: boolean;
  w?: number;
  h?: number;
  large_url?: string;
};
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
  const probeAliveFn = useServerFn(probeVisibleImagesAlive);
  const restoreIdentityFn = useServerFn(setImageManualKeep);
  const genAllegroFn = useServerFn(generateAllegroDescription);
  const auditFn = useServerFn(runAuditForProduct);
  const approveFn = useServerFn(approveProduct);
  const unapproveFn = useServerFn(unapproveProduct);
  const regenFn = useServerFn(regenerateMainImage);
  const analyzeForPromptFn = useServerFn(analyzeProductImagesForPrompt);
  const clearRegenFn = useServerFn(clearRegeneratedImage);
  const acceptQcFn = useServerFn(acceptThumbnailCandidate);
  const rejectQcFn = useServerFn(rejectThumbnailCandidate);
  const saveVizFn = useServerFn(saveVizAnalysisOverride);
  const pinFn = useServerFn(setPinnedMainImage);
  const removeGalleryFn = useServerFn(removeGalleryUrl);
  const recleanFn = useServerFn(recleanProductSources);
  const resetSourcesFn = useServerFn(resetProductSources);
  const deleteProductsFn = useServerFn(deleteProducts);
  const attachManualFn = useServerFn(attachManualSources);
  const removeSourceFn = useServerFn(removePickedSource);
  const setModeFn = useServerFn(setMatchingMode);
  const rerunMatchFn = useServerFn(rerunMatchingForProduct);
  const updateNotesFn = useServerFn(updateProductNotes);
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () =>
      deleteProductsFn({ data: { projectId: id, productIds: [pid] } }),
    onSuccess: () => {
      toast.success("Produkt usunięty");
      navigate({ to: "/projects/$id", params: { id } });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Nie udało się usunąć");
    },
  });
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

  const resetSourcesMut = useMutation({
    mutationFn: () =>
      resetSourcesFn({ data: { projectId: id, productIds: [pid] } }),
    onSuccess: (res) => {
      toast.success(
        `Zresetowano produkt: usunięto ${res.deletedSearchRows} wpisów wyszukiwania. Wróć na etap Import.`,
      );
      qc.invalidateQueries({ queryKey: ["product", id, pid] });
      qc.invalidateQueries({ queryKey: ["project", id, "products"] });
    },
    onError: (e) => toast.error(friendlyError(e, "Nie udało się zresetować źródeł")),
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
  const [revalidating, setRevalidating] = useState(false);
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});
  const analyzedKeyRef = useRef<string>("");
  const [productNotes, setProductNotes] = useState("");
  const [notesInitial, setNotesInitial] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [manualUrlInput, setManualUrlInput] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [removingSource, setRemovingSource] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTouched, setAuditTouched] = useState(false);

  const onRemoveSource = async (url: string) => {
    if (removingSource) return;
    if (!confirm("Usunąć to źródło z tego produktu? Nie będzie brane pod uwagę w kolejnych dopasowaniach.")) return;
    setRemovingSource(url);
    try {
      await removeSourceFn({ data: { projectId: id, productId: pid, url } });
      toast.success("Źródło usunięte");
      invalidate();
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się usunąć źródła"));
    } finally {
      setRemovingSource(null);
    }
  };

  useEffect(() => {
    const n = ((data as { product?: { product_notes?: string | null } } | undefined)?.product?.product_notes ?? "") || "";
    setProductNotes(n);
    setNotesInitial(n);
    if (n) setNotesOpen(true);
  }, [data?.product]);

  const saveNotes = async () => {
    if (productNotes === notesInitial) return;
    setNotesSaving(true);
    try {
      await updateNotesFn({ data: { productId: pid, notes: productNotes || null } });
      setNotesInitial(productNotes);
      toast.success("Notatki zapisane");
      qc.invalidateQueries({ queryKey: ["product", id, pid] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nie udało się zapisać notatek");
    } finally {
      setNotesSaving(false);
    }
  };

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

  // Manual re-verify: force re-run of the identity check for every visible
  // image (up to the server-fn cap) with the new anchor-reference logic.
  // Manually-kept and hidden entries are protected server-side.
  const revalidateImages = async () => {
    const visible = allVisible.filter((u) => !hiddenSet.has(u));
    if (!visible.length) {
      toast.info("Brak widocznych zdjęć do weryfikacji");
      return;
    }
    setRevalidating(true);
    try {
      analyzedKeyRef.current = "revalidated"; // stop the auto-analyze effect from firing again
      // 1) Cheap HEAD-probe over EVERY visible URL — flags dead ones so the
      //    gallery hides them. Not bounded by the 8-URL AI cap.
      const probe = await probeAliveFn({ data: { productId: pid, revalidate: true } });
      // 2) AI identity re-scoring on the alive subset (capped at 8).
      const aliveUrls = (probe?.alive ?? visible.filter((u) => !new Set(probe?.dead ?? []).has(u))).slice(0, 8);
      if (aliveUrls.length) {
        await analyzeFn({ data: { productId: pid, urls: aliveUrls, revalidate: true } });
      }
      const deadCount = probe?.dead?.length ?? 0;
      toast.success(
        deadCount
          ? `Zweryfikowano ${aliveUrls.length} zdjęć · ${deadCount} martwych`
          : `Zweryfikowano ${aliveUrls.length} zdjęć`,
      );
      invalidate();
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się zweryfikować zdjęć"));
    } finally {
      setRevalidating(false);
    }
  };

  // Derive top-4 visible images and trigger AI scoring for missing ones.
  const imageMeta = (((data as { image_meta?: Record<string, ImgMeta> } | undefined)?.image_meta) ?? {}) as Record<string, ImgMeta>;
  const imageScores = (((data as { image_scores?: Record<string, ImgScore> } | undefined)?.image_scores) ?? {}) as Record<string, ImgScore>;

  const allVisible: string[] = [];
  const regenUrlEarly = resolveRegenUrl(
    (((data as { enrichment?: { regenerated_main_image?: string | null } } | undefined)?.enrichment?.regenerated_main_image) ?? null) as string | null,
  );
  if (regenUrlEarly) allVisible.push(regenUrlEarly);
  // Client-imported images (from CSV/XLSX) are tier-0 gallery entries —
  // always visible, never subject to AI banner/identity verdicts. They
  // appear before any source-derived images so an imported-only product
  // still has a populated gallery + main image for regen/visualization.
  const importedImages = (((data as { imported_images?: string[] } | undefined)?.imported_images) ?? []) as string[];
  const importedSet = new Set(importedImages);
  for (const u of importedImages) if (u && !allVisible.includes(u)) allVisible.push(u);
  if (data?.sources) {
    for (const s of data.sources) {
      for (const u of s.images) if (!allVisible.includes(u)) allVisible.push(u);
      for (const u of s.extra_images) if (!allVisible.includes(u)) allVisible.push(u);
    }
  }
  // Dead URLs and (in compatible mode) images from non-primary equivalent
  // sources never appear in the "Wybrane zdjęcia" grid — they get their own
  // collapsed sections below.
  const deadImageSet = new Set(
    (((data as { dead_images?: string[] } | undefined)?.dead_images) ?? []) as string[],
  );
  const otherEquivImageSet = new Set(
    (((data as { other_equivalent_images?: string[] } | undefined)?.other_equivalent_images) ?? []) as string[],
  );
  {
    const filtered = allVisible.filter((u) => !deadImageSet.has(u) && !otherEquivImageSet.has(u));
    allVisible.length = 0;
    allVisible.push(...filtered);
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
    const s = imageScores[url];
    // Prefer probed dimensions from image_scores (fresh) over image_meta.
    const w = s?.w ?? m?.w ?? 0;
    const h = s?.h ?? m?.h ?? 0;
    const area = w * h;
    const minSide = w && h ? Math.min(w, h) : 0;
    // Boost images that comfortably clear the 800px main-image threshold.
    const resolutionBoost = minSide >= 800 ? 2 : minSide >= 600 ? 1 : minSide > 0 ? 0.5 : 1;
    // Fallback gdy brak wymiarów (image_meta puste) — oceniaj tylko po AI.
    const effectiveArea = (area > 0 ? area : 1) * resolutionBoost;
    if (!s) return area * resolutionBoost;
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
    (pinnedMainUrl && !hiddenSet.has(pinnedMainUrl) && (allVisible.includes(pinnedMainUrl) || pinnedMainUrl === regeneratedMainUrl || importedSet.has(pinnedMainUrl)))
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

  const audit = useMutation({
    mutationFn: () => auditFn({ data: { productId: pid } }),
    onSuccess: async () => {
      setAuditTouched(true);
      setAuditOpen(true);
      toast.success("Audyt AI zakończony");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["product", id, pid] }),
        qc.invalidateQueries({ queryKey: ["project", id, "products"] }),
      ]);
    },
    onError: (e) => toast.error(friendlyError(e, "Audyt AI nie powiódł się")),
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
    mutationFn: (vars: { enrichmentId: string; imageUrl: string; customStyle?: string; customRequirements?: string }) =>
      regenFn({ data: vars }),
    onSuccess: () => { toast.success("Zdjęcie zregenerowane"); invalidate(); },
    onError: (e) => toast.error(friendlyError(e, "Regeneracja nie powiodła się")),
  });

  const [regenStyle, setRegenStyle] = useState("");
  const [regenReq, setRegenReq] = useState("");
  const [visionBusy, setVisionBusy] = useState(false);
  const analyzeForThumb = async () => {
    setVisionBusy(true);
    try {
      const out = await analyzeForPromptFn({ data: { productId: pid, mode: "thumbnail" } });
      setRegenStyle(out.style);
      setRegenReq(out.requirements);
      toast.success(`AI przeanalizowała ${out.analyzed} zdjęcie/zdjęć`);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się przeanalizować zdjęć"));
    } finally {
      setVisionBusy(false);
    }
  };

  const clearRegenMut = useMutation({
    mutationFn: (enrichmentId: string) => clearRegenFn({ data: { enrichmentId } }),
    onSuccess: () => { toast.success("Cofnięto regenerację"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const acceptQcMut = useMutation({
    mutationFn: (enrichmentId: string) => acceptQcFn({ data: { enrichmentId } }),
    onSuccess: () => { toast.success("Zaakceptowano kandydata miniatury"); invalidate(); },
    onError: (e) => toast.error(friendlyError(e, "Nie udało się zaakceptować kandydata")),
  });
  const rejectQcMut = useMutation({
    mutationFn: (enrichmentId: string) => rejectQcFn({ data: { enrichmentId } }),
    onSuccess: () => { toast.success("Kandydat odrzucony"); invalidate(); },
    onError: (e) => toast.error(friendlyError(e, "Nie udało się odrzucić kandydata")),
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
  const regeneratedUrl = resolveRegenUrl(
    (enrichment as { regenerated_main_image?: string | null } | null)?.regenerated_main_image ?? null,
  );
  const scoreBreakdown = (((enrichment as { score_breakdown?: unknown } | null)?.score_breakdown) ?? []) as Array<{ url?: string; deduped?: boolean; ean_confirmed?: boolean; manual?: boolean }>;
  const dedupedCount = scoreBreakdown.filter((s) => s.deduped === true).length;
  const eanConfirmedByUrl = new Map<string, boolean>();
  const manualByUrl = new Map<string, boolean>();
  for (const b of scoreBreakdown) {
    if (b?.url) eanConfirmedByUrl.set(b.url, !!b.ean_confirmed);
    if (b?.url && b.manual === true) manualByUrl.set(b.url, true);
  }
  const productMatchingMode = ((product as { matching_mode?: string | null }).matching_mode === "compatible")
    ? "compatible"
    : "strict";
  const compatSuggested = !!(enrichment as { compat_suggested?: boolean } | null)?.compat_suggested;
  const hasAnyEanConfirmed = Array.from(eanConfirmedByUrl.values()).some(Boolean);
  // The main image "comes from" a source when that image appears in the
  // source's images/extra_images list. Warn only when we have at least one
  // ean-confirmed source and the current main image isn't in any of them.
  const mainFromEanConfirmed = (() => {
    if (!mainUrl) return false;
    for (const s of sources) {
      if (!eanConfirmedByUrl.get(s.url)) continue;
      if (s.images.includes(mainUrl) || s.extra_images.includes(mainUrl)) return true;
    }
    return false;
  })();

  const renderThumb = (u: string, extra: boolean) => {
    const s = imageScores[u];
    const isMain = u === mainUrl;
    const isPinned = u === pinnedMainUrl;
    const isImported = importedSet.has(u);
    const m = imageMeta[u];
    const w = s?.w ?? m?.w ?? 0;
    const h = s?.h ?? m?.h ?? 0;
    const minSide = w && h ? Math.min(w, h) : 0;
    const isLowRes = minSide > 0 && minSide < 800;
    return (
      <div
        key={u}
        className={cn(
          "relative group rounded border-2 p-0.5",
          isMain ? "border-emerald-500 ring-2 ring-emerald-500/40" : "border-transparent",
        )}
      >
        <img src={u} alt="" className="h-24 w-24 rounded object-cover" />
        {w > 0 && h > 0 && (
          <span
            className={cn(
              "absolute bottom-0 right-0 text-[9px] font-medium px-1 py-0 rounded-tl border-l border-t",
              isLowRes
                ? "bg-amber-500/90 text-white border-amber-600"
                : "bg-background/80 text-muted-foreground border-border",
            )}
            title={
              isLowRes
                ? `Niska rozdzielczość: ${w}×${h}px (min. 800px)`
                : `${w}×${h}px`
            }
          >
            {w}×{h}
          </span>
        )}
        {isMain && (
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow flex items-center gap-1">
            <Crown className="h-2.5 w-2.5" /> Główne{isPinned ? " (przypięte)" : ""}
          </span>
        )}
        {extra && <Badge variant="outline" className="absolute top-0 left-0 text-[10px] px-1 py-0">extra</Badge>}
        {isImported && (
          <Badge
            variant="outline"
            className="absolute top-0 left-0 text-[10px] px-1 py-0 bg-sky-500/10 text-sky-700 border-sky-500/40"
            title="Zdjęcie zaimportowane z pliku klienta (CSV/XLSX). Nie podlega weryfikacji AI."
          >
            Z pliku klienta
          </Badge>
        )}
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
          {((product as { category?: string | null }).category ?? "").trim() && (
            <p className="mt-1 text-xs text-muted-foreground">
              Kategoria: <span className="font-medium text-foreground">{(product as { category?: string | null }).category}</span>
            </p>
          )}
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
          {reclean.isPending ? "Czyszczenie…" : "Wyczyść śmieci"}
        </Button>
        <Button
          variant="outline"
          title="Pełny reset: usuwa wpisy wyszukiwania dla tego produktu i wraca go na etap Import. Nie ruszy blokady ręcznej ani statusu zatwierdzenia."
          disabled={resetSourcesMut.isPending}
          onClick={() => {
            if (
              confirm(
                "Zresetować źródła dla tego produktu?\n\nUsunie wpisy wyszukiwania i wróci produkt na etap Import.",
              )
            ) {
              resetSourcesMut.mutate();
            }
          }}
        >
          {resetSourcesMut.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Eraser className="h-4 w-4 mr-2" />
          )}
          {resetSourcesMut.isPending ? "Reset…" : "Reset źródeł"}
        </Button>
        <Button
          onClick={() => regenAll.mutate()}
          disabled={regenAll.isPending || sources.length === 0}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {regenAll.isPending ? "Generowanie..." : "Generuj z 3 źródeł"}
        </Button>
        <Button
          variant="destructive"
          onClick={() => setDeleteOpen(true)}
          disabled={deleteMut.isPending}
          title="Usuń ten produkt z projektu"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {deleteMut.isPending ? "Usuwam…" : "Usuń produkt"}
        </Button>
        </div>
      </div>

      <Collapsible open={notesOpen} onOpenChange={setNotesOpen} className="mb-6">
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notatki do tego produktu (wewnętrzne, wstrzykiwane do promptów AI)
              {notesInitial.trim() ? (
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">{notesOpen ? "Zwiń" : "Rozwiń"}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          <Textarea
            value={productNotes}
            onChange={(e) => setProductNotes(e.target.value)}
            onBlur={saveNotes}
            rows={5}
            maxLength={2000}
            placeholder="Wskazówki tylko dla AI, np. „podkreśl wersję lewostronną”, „unikaj słowa X”, „w opisie wymień kompatybilność z modelem Y”."
          />
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>{productNotes.length} / 2000 · zapis automatyczny po opuszczeniu pola</span>
            <span>{notesSaving ? "Zapisywanie…" : productNotes !== notesInitial ? "Nie zapisano" : "Zapisane"}</span>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {(() => {
        const variants = (((data as { variants?: Array<{ id: string; kod: string | null; ean: string | null; nazwa: string | null; attrs: Record<string, string> }> } | undefined)?.variants) ?? []);
        if (!variants.length) return null;
        const attrKeys = Array.from(
          new Set(variants.flatMap((v) => Object.keys(v.attrs))),
        ).slice(0, 6);
        return (
          <div className="mb-6 rounded-lg border bg-card p-3">
            <div className="mb-2 text-sm font-medium">
              Warianty tego produktu <span className="text-muted-foreground">({variants.length})</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Warianty są pomijane w pipeline (wykluczone z powodem „variant”) i eksportowane razem z rodzicem.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-1 pr-3">SKU</th>
                    <th className="text-left py-1 pr-3">EAN</th>
                    {attrKeys.map((k) => (
                      <th key={k} className="text-left py-1 pr-3">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.id} className="border-b last:border-b-0">
                      <td className="py-1 pr-3 font-mono">{v.kod ?? "—"}</td>
                      <td className="py-1 pr-3 font-mono">{v.ean ?? "—"}</td>
                      {attrKeys.map((k) => (
                        <td key={k} className="py-1 pr-3">{v.attrs[k] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      <ProductSearchResults projectId={id} productId={pid} productName={product.nazwa ?? ""} />

      <ProductTimeline productId={pid} />

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
                    <Wand2 className="h-3.5 w-3.5 text-violet-500" /> Miniatura Allegro (czyste białe tło)
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Wyłącznie sam produkt na #FFFFFF, miękki cień, ~70% kadru, JPG 2560×2560. Zdjęcie główne oferty Allegro.
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
                      regenMut.mutate({
                        enrichmentId: enrichment.id,
                        imageUrl: mainUrl,
                        customStyle: regenStyle.trim() || undefined,
                        customRequirements: regenReq.trim() || undefined,
                      });
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
              <div className="rounded-md border border-violet-200 bg-violet-50/40 dark:bg-violet-950/20 p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px]">
                    <div className="font-medium">Wskazówki wizualne (opcjonalnie)</div>
                    <div className="text-muted-foreground">AI podpowie na bazie zdjęć źródłowych. Białe tło i proporcje pozostają nadrzędne.</div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={analyzeForThumb}
                    disabled={visionBusy || regenMut.isPending}
                  >
                    {visionBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                    Analizuj zdjęcia
                  </Button>
                </div>
                <Textarea
                  value={regenStyle}
                  onChange={(e) => setRegenStyle(e.target.value)}
                  placeholder="Styl / kadr (np. lekki kąt ¾, rozłożone akcesoria, delikatny cień kontaktowy)"
                  rows={2}
                  className="text-xs"
                />
                <Textarea
                  value={regenReq}
                  onChange={(e) => setRegenReq(e.target.value)}
                  placeholder="Wymagania (np. pokaż etykietę frontem, zachowaj kolor zielony pudełka)"
                  rows={2}
                  className="text-xs"
                />
              </div>
              {regenMut.isPending && (
                <p className="text-[11px] text-muted-foreground italic">
                  Generuję zdjęcie produktowe… (10–40 s)
                </p>
              )}
              {(() => {
                if (!mainUrl) return null;
                const s = imageScores[mainUrl];
                const m = imageMeta[mainUrl];
                const w = s?.w ?? m?.w ?? 0;
                const h = s?.h ?? m?.h ?? 0;
                if (!w || !h) return null;
                const minSide = Math.min(w, h);
                if (minSide >= 800) return null;
                const largeAlt =
                  s?.large_url && !hiddenSet.has(s.large_url) ? s.large_url : null;
                return (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-[11px] space-y-1">
                    <div className="font-medium text-amber-800 dark:text-amber-300">
                      Zdjęcie główne ma niską rozdzielczość: {w}×{h}px
                    </div>
                    <div className="text-muted-foreground">
                      Zalecane min. 800×800px do regeneracji e-commerce.
                      {largeAlt ? " Dostępny większy wariant tego samego zdjęcia." : ""}
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const qc = ((imageMeta as unknown as { thumbnail_qc?: {
                  bg_white?: boolean;
                  product_intact?: boolean;
                  framing_ok?: boolean;
                  issues?: string[];
                  candidate_url?: string | null;
                  attempts?: number;
                } }).thumbnail_qc) ?? null;
                if (!qc) return null;
                const candidate = qc.candidate_url ?? null;
                if (!candidate) return null;
                const reasons: string[] = [];
                if (qc.bg_white === false) reasons.push("tło nie jest białe");
                if (qc.product_intact === false) reasons.push("produkt zmieniony vs. referencja");
                if (qc.framing_ok === false) reasons.push("kadr poza normą");
                const reasonsText = reasons.length ? reasons.join(", ") : "kontrola jakości";
                return (
                  <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-2 text-[11px] space-y-2">
                    <div className="font-medium text-amber-800 dark:text-amber-300">
                      Nowa miniatura nie przeszła kontroli jakości ({reasonsText})
                    </div>
                    {qc.issues && qc.issues.length > 0 && (
                      <ul className="list-disc pl-4 text-muted-foreground">
                        {qc.issues.slice(0, 3).map((iss, idx) => (
                          <li key={idx}>{iss}</li>
                        ))}
                      </ul>
                    )}
                    <a href={candidate} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={candidate}
                        alt="Kandydat miniatury"
                        className="w-full max-h-56 object-contain rounded border bg-white"
                      />
                    </a>
                    <div className="flex gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!enrichment || rejectQcMut.isPending || acceptQcMut.isPending}
                        onClick={() => enrichment && rejectQcMut.mutate(enrichment.id)}
                      >
                        {rejectQcMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                        Odrzuć
                      </Button>
                      <Button
                        size="sm"
                        disabled={!enrichment || acceptQcMut.isPending || rejectQcMut.isPending}
                        onClick={() => enrichment && acceptQcMut.mutate(enrichment.id)}
                      >
                        {acceptQcMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                        Użyj mimo to
                      </Button>
                    </div>
                  </div>
                );
              })()}
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
              {hasAnyEanConfirmed && mainUrl && !mainFromEanConfirmed && (
                <p className="text-[11px] text-amber-600 italic">
                  Zdjęcie główne pochodzi ze źródła bez potwierdzonego EAN.
                </p>
              )}
            </div>

            {/* Galeria wybranych zdjęć ze wszystkich dopasowanych źródeł */}
            <div className="rounded border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Wybrane zdjęcia</p>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {allVisible.filter((u) => !hiddenSet.has(u)).length} widocznych
                    {hiddenImages.length ? ` · ${hiddenImages.length} ukrytych` : ""}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revalidating}
                    title="Ponownie sprawdź tożsamość widocznych zdjęć porównując je z obrazem referencyjnym (przypiętym/zregenerowanym) i nazwą produktu."
                    onClick={revalidateImages}
                  >
                    {revalidating ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3 w-3 mr-1" />
                    )}
                    {revalidating ? "Weryfikuję…" : "Zweryfikuj zdjęcia ponownie"}
                  </Button>
                </div>
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
                      Brak zdjęć — dodaj plik CSV ze zdjęciami lub dopasuj źródła.
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
              {(() => {
                const rejected = (((data as { rejected_identity_images?: string[] } | undefined)?.rejected_identity_images) ?? []) as string[];
                if (!rejected.length) return null;
                return (
                  <details className="pt-1">
                    <summary className="text-[11px] text-amber-700 dark:text-amber-400 cursor-pointer hover:text-foreground">
                      Odrzucone (inny produkt) — {rejected.length}
                    </summary>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      AI stwierdziła, że te zdjęcia pokazują inny produkt niż aktualny. Kliknij, aby przywrócić.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 opacity-70">
                      {rejected.map((u) => (
                        <div key={u} className="relative group rounded border border-amber-400/40 p-0.5">
                          <img src={u} alt="" className="h-24 w-24 rounded object-cover grayscale" />
                          <button
                            onClick={async () => {
                              try {
                                await restoreIdentityFn({ data: { productId: pid, url: u, keep: true } });
                                toast.success("Przywrócono zdjęcie");
                                invalidate();
                              } catch (e) {
                                toast.error(friendlyError(e, "Nie udało się przywrócić"));
                              }
                            }}
                            className="absolute top-0 right-0 bg-background border rounded p-0.5 opacity-0 group-hover:opacity-100 transition"
                            title="Przywróć (zachowaj mimo weryfikacji AI)"
                          >
                            <Undo2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}
              {(() => {
                const unsure = (((data as { unsure_identity_images?: string[] } | undefined)?.unsure_identity_images) ?? []) as string[];
                if (!unsure.length) return null;
                return (
                  <details className="pt-1">
                    <summary className="text-[11px] text-sky-700 dark:text-sky-400 cursor-pointer hover:text-foreground">
                      Niepewne — do weryfikacji ({unsure.length})
                    </summary>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      AI nie mogła jednoznacznie potwierdzić, że to ten produkt. Zaakceptuj (dopisz do galerii) lub odrzuć (ukryj).
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                      {unsure.map((u) => (
                        <div key={u} className="relative group rounded border border-sky-400/40 p-0.5">
                          <img src={u} alt="" className="h-24 w-24 rounded object-cover" />
                          <div className="absolute inset-x-0 bottom-0 flex justify-between opacity-0 group-hover:opacity-100 transition">
                            <button
                              onClick={async () => {
                                try {
                                  await restoreIdentityFn({ data: { productId: pid, url: u, keep: true } });
                                  toast.success("Zaakceptowano zdjęcie");
                                  invalidate();
                                } catch (e) {
                                  toast.error(friendlyError(e, "Nie udało się zaakceptować"));
                                }
                              }}
                              className="bg-emerald-600 text-white rounded p-0.5"
                              title="Zaakceptuj — dodaj do galerii"
                            >
                              <ShieldCheck className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => hideMut.mutate(u)}
                              className="bg-destructive text-destructive-foreground rounded p-0.5"
                              title="Odrzuć — ukryj"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}
              {(() => {
                const deadList = Array.from(deadImageSet);
                if (!deadList.length) return null;
                return (
                  <details className="pt-1">
                    <summary className="text-[11px] text-rose-700 dark:text-rose-400 cursor-pointer hover:text-foreground">
                      Niedostępne ({deadList.length})
                    </summary>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Te zdjęcia nie odpowiadają (404, hotlink, niepoprawny format) — zostały pominięte we wszystkich widokach. „Zweryfikuj zdjęcia ponownie" spróbuje je pobrać jeszcze raz.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 opacity-60">
                      {deadList.map((u) => (
                        <div key={u} className="relative group rounded border border-rose-400/40 p-0.5">
                          <img src={u} alt="" className="h-24 w-24 rounded object-cover grayscale" />
                          <div className="absolute inset-x-0 top-0 flex justify-center text-[9px] text-rose-700 bg-rose-50/90 dark:bg-rose-950/70 dark:text-rose-300 py-0.5">
                            niedostępne
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}
              {(() => {
                if (productMatchingMode !== "compatible") return null;
                const others = Array.from(otherEquivImageSet);
                if (!others.length) return null;
                return (
                  <details className="pt-1">
                    <summary className="text-[11px] text-indigo-700 dark:text-indigo-400 cursor-pointer hover:text-foreground">
                      Z innych zamienników ({others.length})
                    </summary>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      W trybie „zamienniki" główna galeria zawiera zdjęcia tylko z najlepszego źródła. Poniżej zdjęcia z pozostałych równoważnych produktów — kliknij, aby dodać wybrane do galerii.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                      {others.map((u) => (
                        <div key={u} className="relative group rounded border border-indigo-400/40 p-0.5">
                          <img src={u} alt="" className="h-24 w-24 rounded object-cover" />
                          <button
                            onClick={async () => {
                              try {
                                await restoreIdentityFn({ data: { productId: pid, url: u, keep: true } });
                                toast.success("Dodano zdjęcie do galerii");
                                invalidate();
                              } catch (e) {
                                toast.error(friendlyError(e, "Nie udało się dodać zdjęcia"));
                              }
                            }}
                            className="absolute top-0 right-0 bg-emerald-600 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition"
                            title="Dodaj do galerii (manual_keep)"
                          >
                            <ShieldCheck className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}
            </div>

            {/* Wizualizacje AI (lifestyle) */}
            {(() => {
              const viz = ((imageMeta as unknown as { viz_analysis?: {
                style?: string;
                requirements?: string;
                at?: string;
                manual?: boolean;
                source?: string;
                viz_type?: "lifestyle" | "in_use" | "feature_explainer";
                overlay_motif?: string;
                host_device?: { name?: string } | null;
                hide_product_text?: boolean;
                count?: number;
                variants?: Array<{
                  style: string;
                  requirements: string;
                  viz_type?: "lifestyle" | "in_use" | "feature_explainer";
                  overlay_motif?: string;
                  manual?: boolean;
                }>;
              } }).viz_analysis) ?? null;
              if (!viz) return null;
              const hostDeviceUrl = ((imageMeta as unknown as { host_device_url?: string }).host_device_url ?? "") as string;
              return (
                <VizAnalysisPanel
                  productId={pid}
                  viz={{ ...viz, host_device_url: hostDeviceUrl }}
                  onSave={async (patch) => {
                    await saveVizFn({
                      data: {
                        productId: pid,
                        style: patch.style,
                        requirements: patch.requirements,
                        manual: true,
                        viz_type: patch.viz_type,
                        overlay_motif: patch.overlay_motif,
                        host_device_name: patch.host_device_name,
                        host_device_url: patch.host_device_url,
                        hide_product_text: patch.hide_product_text,
                        variants: patch.variants,
                      },
                    });
                    toast.success("Zapisano manualne nadpisanie sceny");
                    invalidate();
                  }}
                />
              );
            })()}
            {(() => {
              const gallery = (((enrichment as { ai_gallery_urls?: string[] | null } | null)?.ai_gallery_urls) ?? []) as string[];
              if (!gallery.length) return null;
              const vizQcMap =
                (((enrichment as { image_meta?: { viz_qc?: Record<string, { passed?: boolean; product_intact?: boolean; product_visible?: boolean; issues?: string[] }> } | null } | null)?.image_meta?.viz_qc) ?? {}) as Record<
                  string,
                  { passed?: boolean; product_intact?: boolean; product_visible?: boolean; issues?: string[] }
                >;
              return (
                <div className="rounded border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Wand2 className="h-4 w-4" /> Miniatura katalogowa (z rekwizytami)
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {gallery.length} obraz(ów) — nie używać jako zdjęcie główne Allegro
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {gallery.map((u) => {
                      const isPinned = u === pinnedMainUrl;
                      const vq = vizQcMap[u];
                      const vqFailed = vq && vq.passed === false;
                      const vqTitle = vqFailed
                        ? `Wizualizacja: produkt niezgodny z referencją${
                            vq.issues && vq.issues.length ? ` — ${vq.issues.slice(0, 3).join("; ")}` : ""
                          }`
                        : undefined;
                      return (
                        <div
                          key={u}
                          className={cn(
                            "relative group rounded border-2 p-0.5",
                            isPinned ? "border-emerald-500 ring-2 ring-emerald-500/40" : "border-violet-400/60",
                            vqFailed ? "border-amber-500 ring-2 ring-amber-500/40" : "",
                          )}
                          title={vqTitle}
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
                          {vqFailed && (
                            <Badge
                              variant="outline"
                              className="absolute top-0 left-1/2 -translate-x-1/2 text-[10px] px-1 py-0 bg-amber-500/15 text-amber-800 border-amber-500/60 dark:text-amber-200 whitespace-nowrap"
                            >
                              ⚠ niezgodny
                            </Badge>
                          )}
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

            {/* Audit — deterministic checks + LLM cross-check against sources/guidelines. */}
            {(() => {
              const auditData = (enrichment as unknown as {
                audit?: {
                  at: string;
                  verdict: "pass" | "warn" | "fail";
                  checks: Array<{ check: string; ok: boolean; severity: "fail" | "warn"; detail?: string }>;
                  llm: null | {
                    factual_issues: string[];
                    guideline_violations: string[];
                    style_issues: string[];
                    verdict: "pass" | "warn" | "fail";
                  };
                } | null;
              } | null)?.audit ?? null;
              const verdict = auditData?.verdict ?? null;
              const badgeCls =
                verdict === "pass"
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : verdict === "warn"
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : verdict === "fail"
                      ? "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300"
                      : "border-border bg-muted/30 text-muted-foreground";
              const label =
                verdict === "pass"
                  ? "Audyt OK"
                  : verdict === "warn"
                    ? "Audyt: ostrzeżenia"
                    : verdict === "fail"
                      ? "Audyt: błędy"
                      : "Audyt nieprzeprowadzony";
              const failed = auditData?.checks.filter((c) => !c.ok) ?? [];
              return (
                <div className="pt-4 border-t mt-4 space-y-2">
                  <Collapsible
                    open={auditTouched ? auditOpen : !!verdict && verdict !== "pass"}
                    onOpenChange={(open) => {
                      setAuditTouched(true);
                      setAuditOpen(open);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                        <ChevronDown className="h-3 w-3" />
                        <span>Audyt AI</span>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badgeCls}`}>
                          {label}
                        </Badge>
                        {auditData?.at && (
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(auditData.at).toLocaleString("pl-PL")}
                          </span>
                        )}
                      </CollapsibleTrigger>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const rs = ((data?.product as { review_status?: string | null } | undefined)?.review_status ?? "NONE") as string;
                          if (rs === "APPROVED") {
                            return (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-emerald-500/60 text-emerald-700 dark:text-emerald-300"
                                onClick={async () => {
                                  await unapproveFn({ data: { productId: pid } });
                                  toast.success("Cofnięto zatwierdzenie");
                                  invalidate();
                                }}
                              >
                                <Undo2 className="h-3 w-3 mr-1" /> Cofnij zatwierdzenie
                              </Button>
                            );
                          }
                          return (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={async () => {
                                await approveFn({ data: { productId: pid } });
                                toast.success("Produkt zatwierdzony");
                                invalidate();
                              }}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Zatwierdź produkt
                            </Button>
                          );
                        })()}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!enrichment || audit.isPending}
                          onClick={() => audit.mutate()}
                        >
                          {audit.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          {auditData ? "Uruchom ponownie" : "Uruchom audyt"}
                        </Button>
                      </div>
                    </div>
                    <CollapsibleContent className="mt-2 space-y-2 text-xs">
                      {!auditData && (
                        <p className="italic text-muted-foreground">
                          Audyt jeszcze nie był uruchamiany.
                        </p>
                      )}
                      {auditData && failed.length === 0 && (
                        <p className="text-emerald-600">✓ Wszystkie sprawdzenia OK</p>
                      )}
                      {failed.length > 0 && (
                        <ul className="space-y-1">
                          {failed.map((c) => (
                            <li
                              key={c.check}
                              className={
                                c.severity === "fail" ? "text-destructive" : "text-amber-600"
                              }
                            >
                              {c.severity === "fail" ? "❌" : "⚠"} {c.check}
                              {c.detail ? ` — ${c.detail}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      {auditData?.llm && (
                        <div className="space-y-1 pt-1 border-t">
                          {auditData.llm.factual_issues.length > 0 && (
                            <div>
                              <p className="font-medium">Niezgodności z źródłami:</p>
                              <ul className="list-disc pl-5 text-destructive">
                                {auditData.llm.factual_issues.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {auditData.llm.guideline_violations.length > 0 && (
                            <div>
                              <p className="font-medium">Naruszenia wytycznych klienta:</p>
                              <ul className="list-disc pl-5 text-amber-600">
                                {auditData.llm.guideline_violations.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {auditData.llm.style_issues.length > 0 && (
                            <div>
                              <p className="font-medium">Uwagi stylistyczne:</p>
                              <ul className="list-disc pl-5 text-muted-foreground">
                                {auditData.llm.style_issues.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })()}

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
          {/* Matching-mode toggle + manual source attach */}
          <Card>
            <CardContent className="py-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium">Tryb dopasowywania</div>
                  <div className="text-xs text-muted-foreground">
                    {productMatchingMode === "compatible"
                      ? "Zamiennik / akcesorium — dopasowuje po kompatybilności (typ, parametry, wspólne modele)."
                      : "Ścisły — dopasowuje po marce/modelu/wariancie (EAN, MPN)."}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={productMatchingMode === "compatible" ? "default" : "outline"}
                    disabled={modeBusy}
                    className="rounded-full"
                    onClick={async () => {
                      const next = productMatchingMode === "compatible" ? "strict" : "compatible";
                      setModeBusy(true);
                      try {
                        await setModeFn({ data: { productIds: [pid], mode: next } });
                        toast.success(next === "compatible" ? "Ustawiono tryb: zamiennik/akcesorium" : "Ustawiono tryb: ścisły");
                        // Trigger a rematch for this product with the new mode.
                        await rerunMatchFn({ data: { projectId: id, productId: pid } }).catch(() => {});
                        invalidate();
                      } catch (e) {
                        toast.error(friendlyError(e, "Nie udało się zmienić trybu"));
                      } finally {
                        setModeBusy(false);
                      }
                    }}
                  >
                    {modeBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    {productMatchingMode === "compatible" ? "Zamiennik/akcesorium" : "Przełącz na zamiennik"}
                  </Button>
                </div>
              </div>
              {compatSuggested && productMatchingMode === "strict" && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <span>
                    Wykryto produkt typu <b>zamiennik/akcesorium</b> — ścisłe dopasowanie odrzuciło wszystkie źródła. Przełącz tryb, aby dopasować po kompatybilności.
                  </span>
                </div>
              )}
              <div className="pt-2 border-t">
                <div className="text-sm font-medium">Dodaj źródło (URL)</div>
                <div className="text-xs text-muted-foreground mb-2">
                  Wklej 1–5 adresów oddzielonych spacją, przecinkiem lub nową linią. Ręcznie dodane źródła nie są odrzucane przez AI i przetrwają ponowne dopasowanie.
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Textarea
                    value={manualUrlInput}
                    onChange={(e) => setManualUrlInput(e.target.value)}
                    placeholder="https://sklep1.pl/produkt-a https://sklep2.pl/produkt-b"
                    className="min-h-[64px] flex-1"
                    disabled={manualBusy}
                  />
                  <Button
                    size="sm"
                    disabled={manualBusy || !manualUrlInput.trim()}
                    onClick={async () => {
                      const urls = manualUrlInput
                        .split(/[\s,;]+/)
                        .map((u) => u.trim())
                        .filter(Boolean)
                        .slice(0, 5);
                      if (!urls.length) return;
                      setManualBusy(true);
                      try {
                        const res = await attachManualFn({
                          data: { projectId: id, productId: pid, urls },
                        });
                        if (res.added > 0) {
                          toast.success(`Dodano ${res.added} źródeł ręcznie`);
                          setManualUrlInput("");
                          invalidate();
                        } else {
                          toast.error("Nie udało się dodać żadnego źródła");
                        }
                        if (res.failed && res.failed.length) {
                          for (const f of res.failed) {
                            toast.warning(`${f.url}: ${f.reason}`);
                          }
                        }
                      } catch (e) {
                        toast.error(friendlyError(e, "Nie udało się dodać źródła"));
                      } finally {
                        setManualBusy(false);
                      }
                    }}
                  >
                    {manualBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                    Dodaj
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

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
          {dedupedCount > 0 && (
            <div className="text-xs text-muted-foreground -mt-1">
              Odfiltrowano źródła innych wariantów ({dedupedCount})
            </div>
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
                          {eanConfirmedByUrl.get(s.url) && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-[10px] font-medium align-middle">
                              EAN potwierdzony
                            </span>
                          )}
                          {manualByUrl.get(s.url) && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-sky-100 text-sky-800 px-2 py-0.5 text-[10px] font-medium align-middle">
                              ręczne
                            </span>
                          )}
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
                      {s.cleaning_meta ? (
                        <span
                          className={cn(
                            "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0 border",
                            s.cleaning_meta.cleaned_by === "llm"
                              ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground border-border",
                          )}
                          title={
                            s.cleaning_meta.cleaned_by === "llm"
                              ? `AI clean${
                                  typeof s.cleaning_meta.confidence === "number"
                                    ? ` · confidence ${Math.round(s.cleaning_meta.confidence * 100)}%`
                                    : ""
                                }${
                                  s.cleaning_meta.removed_sections.length
                                    ? `\nUsunięte sekcje: ${s.cleaning_meta.removed_sections.join(", ")}`
                                    : ""
                                }`
                              : "Regex sanitizer (fallback)"
                          }
                        >
                          {s.cleaning_meta.cleaned_by === "llm" ? "AI clean" : "regex"}
                        </span>
                      ) : null}
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
                        {combined.length} zdj.
                      </span>
                      <button
                        type="button"
                        title="Usuń to źródło z produktu"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveSource(s.url);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        disabled={removingSource === s.url}
                        className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        {removingSource === s.url ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </button>
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
                      {s.cleaning_meta?.cleaned_by === "llm" && s.description ? (
                        <div
                          className="text-sm max-h-64 overflow-auto border border-border/50 rounded-2xl p-3 bg-muted/30 prose prose-sm max-w-none dark:prose-invert"
                          // Content is sanitized server-side by whitelistSanitize (only h3/p/ul/li/strong/table/tr/td).
                          dangerouslySetInnerHTML={{ __html: s.description }}
                        />
                      ) : (
                        <div className="text-sm whitespace-pre-wrap max-h-64 overflow-auto border border-border/50 rounded-2xl p-3 bg-muted/30">
                          {s.description ?? "(brak opisu)"}
                        </div>
                      )}
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
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(v) => {
          if (!deleteMut.isPending) setDeleteOpen(v);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć produkt?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Ta operacja jest nieodwracalna. Usunięte zostaną także złoty
                  rekord, wizualizacje AI i dopasowania tego produktu. Źródła
                  (product_sources) i wyniki wyszukiwań pozostają
                  nienaruszone.
                </p>
                <p className="text-foreground font-medium line-clamp-2">
                  „{product.nazwa}"
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>
              Anuluj
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMut.mutate();
              }}
              disabled={deleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending ? "Usuwam…" : "Usuń"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function VizAnalysisPanel({
  productId: _productId,
  viz,
  onSave,
}: {
  productId: string;
  viz: {
    style?: string;
    requirements?: string;
    at?: string;
    manual?: boolean;
    source?: string;
    viz_type?: "lifestyle" | "in_use" | "feature_explainer";
    overlay_motif?: string;
    host_device?: { name?: string } | null;
    host_device_url?: string;
    hide_product_text?: boolean;
    count?: number;
    variants?: Array<{
      style: string;
      requirements: string;
      viz_type?: "lifestyle" | "in_use" | "feature_explainer";
      overlay_motif?: string;
      manual?: boolean;
    }>;
  };
  onSave: (patch: {
    style: string;
    requirements: string;
    viz_type: "lifestyle" | "in_use" | "feature_explainer";
    overlay_motif: string;
    host_device_name: string;
    host_device_url: string;
    hide_product_text: boolean;
    variants?: Array<{
      style: string;
      requirements: string;
      viz_type: "lifestyle" | "in_use" | "feature_explainer";
      overlay_motif: string;
      manual: boolean;
    }>;
  }) => Promise<void>;
}) {
  const [style, setStyle] = useState((viz.style ?? "").trim());
  const [requirements, setRequirements] = useState((viz.requirements ?? "").trim());
  const [vizType, setVizType] = useState<"lifestyle" | "in_use" | "feature_explainer">(
    viz.viz_type ?? "lifestyle",
  );
  const [overlayMotif, setOverlayMotif] = useState((viz.overlay_motif ?? "").trim());
  const [hostDeviceName, setHostDeviceName] = useState((viz.host_device?.name ?? "").trim());
  const [hostDeviceUrl, setHostDeviceUrl] = useState((viz.host_device_url ?? "").trim());
  const [hideProductText, setHideProductText] = useState<boolean>(viz.hide_product_text === true);
  type VariantDraft = {
    style: string;
    requirements: string;
    viz_type: "lifestyle" | "in_use" | "feature_explainer";
    overlay_motif: string;
    manual: boolean;
  };
  const initialVariants: VariantDraft[] = (viz.variants ?? []).map((v) => ({
    style: (v.style ?? "").trim(),
    requirements: (v.requirements ?? "").trim(),
    viz_type: v.viz_type ?? "lifestyle",
    overlay_motif: (v.overlay_motif ?? "").trim(),
    manual: v.manual === true,
  }));
  const [variants, setVariants] = useState<VariantDraft[]>(initialVariants);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setStyle((viz.style ?? "").trim());
    setRequirements((viz.requirements ?? "").trim());
    setVizType(viz.viz_type ?? "lifestyle");
    setOverlayMotif((viz.overlay_motif ?? "").trim());
    setHostDeviceName((viz.host_device?.name ?? "").trim());
    setHostDeviceUrl((viz.host_device_url ?? "").trim());
    setHideProductText(viz.hide_product_text === true);
    setVariants((viz.variants ?? []).map((v) => ({
      style: (v.style ?? "").trim(),
      requirements: (v.requirements ?? "").trim(),
      viz_type: v.viz_type ?? "lifestyle",
      overlay_motif: (v.overlay_motif ?? "").trim(),
      manual: v.manual === true,
    })));
  }, [viz.style, viz.requirements, viz.viz_type, viz.overlay_motif, viz.host_device?.name, viz.host_device_url, viz.hide_product_text, viz.variants]);
  const dirty =
    style.trim() !== (viz.style ?? "").trim() ||
    requirements.trim() !== (viz.requirements ?? "").trim() ||
    vizType !== (viz.viz_type ?? "lifestyle") ||
    overlayMotif.trim() !== (viz.overlay_motif ?? "").trim() ||
    hostDeviceName.trim() !== (viz.host_device?.name ?? "").trim() ||
    hostDeviceUrl.trim() !== (viz.host_device_url ?? "").trim() ||
    hideProductText !== (viz.hide_product_text === true) ||
    JSON.stringify(variants) !== JSON.stringify(initialVariants);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Scena AI dla tego produktu
            {viz.manual && (
              <Badge variant="outline" className="text-[10px]">Manual</Badge>
            )}
            {viz.count && viz.count > 1 && (
              <Badge variant="secondary" className="text-[10px]">{viz.count} wariantów</Badge>
            )}
          </p>
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <ChevronDown className={cn("h-3.5 w-3.5 mr-1 transition-transform", open && "rotate-180")} />
              {open ? "Zwiń" : "Edytuj"}
            </Button>
          </CollapsibleTrigger>
        </div>
        {!open && (
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <div className="line-clamp-2"><b>Scena:</b> {viz.style || "—"}</div>
            <div className="line-clamp-2"><b>Wymagania:</b> {viz.requirements || "—"}</div>
            {hideProductText && <div className="text-amber-700"><b>Tryb bez napisów</b> (klient sprzedaje wersję bez brandingu)</div>}
          </div>
        )}
        <CollapsibleContent className="space-y-2">
          <label className="flex items-start gap-2 rounded border bg-background/60 p-2 text-xs">
            <input
              type="checkbox"
              checked={hideProductText}
              onChange={(e) => setHideProductText(e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium">Ukryj nadruki na produkcie</div>
              <div className="text-muted-foreground">
                Włącz gdy klient sprzedaje wersję bez brandingu — powierzchnia produktu na wizualizacji będzie bez napisów/logo, niezależnie od referencji.
              </div>
            </div>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Typ wizualizacji</label>
              <select
                className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                value={vizType}
                onChange={(e) => setVizType(e.target.value as typeof vizType)}
              >
                <option value="lifestyle">Lifestyle (produkt w scenie)</option>
                <option value="in_use">In-use (produkt w działaniu / instalacji)</option>
                <option value="feature_explainer">Feature explainer (produkt + overlay funkcji)</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Motyw overlayu (feature_explainer)</label>
              <Input
                value={overlayMotif}
                onChange={(e) => setOverlayMotif(e.target.value)}
                placeholder="np. półprzezroczysty stożek zasięgu 120°"
                disabled={vizType !== "feature_explainer"}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Urządzenie docelowe (nazwa)</label>
              <Input
                value={hostDeviceName}
                onChange={(e) => setHostDeviceName(e.target.value)}
                placeholder="np. rekuperator Wanas HRV350"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Zdjęcie urządzenia (URL)</label>
              <Input
                value={hostDeviceUrl}
                onChange={(e) => setHostDeviceUrl(e.target.value)}
                placeholder="https://…/urzadzenie.jpg"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Scena / stylistyka</label>
            <Textarea rows={2} value={style} onChange={(e) => setStyle(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Wymagania techniczne</label>
            <Textarea rows={3} value={requirements} onChange={(e) => setRequirements(e.target.value)} />
          </div>
          {variants.length > 1 && (
            <div className="space-y-2 border-t pt-2">
              <p className="text-[11px] font-medium text-muted-foreground">Warianty scen (używane przy generowaniu wielu wizualizacji)</p>
              {variants.map((v, i) => (
                <div key={i} className="rounded border bg-background/40 p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium">Wariant {i + 1}</span>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[11px]">
                        <input
                          type="checkbox"
                          checked={v.manual === true}
                          onChange={(e) => {
                            setVariants((prev) => prev.map((x, k) => k === i ? { ...x, manual: e.target.checked } : x));
                          }}
                        />
                        {v.manual ? "Manual" : "Auto"}
                      </label>
                      <select
                        value={v.viz_type}
                        onChange={(e) => {
                          const nv = e.target.value as VariantDraft["viz_type"];
                          setVariants((prev) => prev.map((x, k) => k === i ? { ...x, viz_type: nv } : x));
                        }}
                        className="h-7 rounded-md border bg-background px-1.5 text-[11px]"
                      >
                        <option value="lifestyle">lifestyle</option>
                        <option value="in_use">in_use</option>
                        <option value="feature_explainer">feature_explainer</option>
                      </select>
                    </div>
                  </div>
                  <Textarea
                    rows={2}
                    value={v.style}
                    onChange={(e) => setVariants((prev) => prev.map((x, k) => k === i ? { ...x, style: e.target.value } : x))}
                    placeholder="Scena"
                    className="text-xs"
                  />
                  <Textarea
                    rows={3}
                    value={v.requirements}
                    onChange={(e) => setVariants((prev) => prev.map((x, k) => k === i ? { ...x, requirements: e.target.value } : x))}
                    placeholder="Wymagania"
                    className="text-xs"
                  />
                  {v.viz_type === "feature_explainer" && (
                    <Input
                      value={v.overlay_motif}
                      onChange={(e) => setVariants((prev) => prev.map((x, k) => k === i ? { ...x, overlay_motif: e.target.value } : x))}
                      placeholder="Motyw overlayu"
                      className="h-7 text-xs"
                    />
                  )}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                Warianty z zaznaczonym „Manual" nie zostaną nadpisane przy ponownej analizie sceny.
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={busy || !dirty || !style.trim() || !requirements.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSave({
                    style: style.trim(),
                    requirements: requirements.trim(),
                    viz_type: vizType,
                    overlay_motif: overlayMotif.trim(),
                    host_device_name: hostDeviceName.trim(),
                    host_device_url: hostDeviceUrl.trim(),
                    hide_product_text: hideProductText,
                    variants: variants.length ? variants.map((v) => ({
                      style: v.style.trim(),
                      requirements: v.requirements.trim(),
                      viz_type: v.viz_type,
                      overlay_motif: v.overlay_motif.trim(),
                      manual: v.manual,
                    })) : undefined,
                  });
                } catch (e) {
                  toast.error(friendlyError(e, "Nie udało się zapisać"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Zatwierdź i użyj przy następnej generacji
            </Button>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Product activity timeline. Collapsible, newest-first. Each row renders the
// message + relative time; rows with structured meta expand to show details.
// ---------------------------------------------------------------------------
function eventIcon(kind: string): string {
  switch (kind) {
    case "discovery_search": return "🔎";
    case "ai_preselect": return "🎯";
    case "discovery_scrape": return "🧾";
    case "matching_done": return "🧩";
    case "rescrape": return "🔁";
    case "golden_generated": return "✍️";
    case "allegro_generated": return "🛒";
    case "media_generated": return "🖼";
    case "image_verify": return "👁";
    case "audit_done": return "🔍";
    case "review_change": return "✅";
    case "manual_edit": return "✏️";
    default: return "•";
  }
}

function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function ProductTimeline({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ProductEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [exhausted, setExhausted] = useState(false);
  const fetchEvents = useServerFn(getProductEvents);

  const load = async (before?: string) => {
    setLoading(true);
    try {
      const rows = await fetchEvents({ data: { productId, limit: 50, ...(before ? { beforeAt: before } : {}) } });
      if (before) {
        setEvents((prev) => [...prev, ...rows]);
      } else {
        setEvents(rows);
      }
      if (rows.length < 50) setExhausted(true);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się wczytać historii"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && events.length === 0 && !loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-6">
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between">
          <span className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Historia produktu (audyt zdarzeń)
          </span>
          <span className="text-xs text-muted-foreground">{open ? "Zwiń" : "Rozwiń"}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <Card>
          <CardContent className="pt-4 space-y-2">
            {loading && events.length === 0 ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Wczytuję historię…
              </div>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Brak zdarzeń — historia zbierana od teraz.</p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((ev) => {
                  const hasMeta = ev.meta && typeof ev.meta === "object" && Object.keys(ev.meta).length > 0;
                  const isOpen = !!expanded[ev.id];
                  return (
                    <li key={ev.id} className="rounded border bg-muted/20 px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => hasMeta && setExpanded((p) => ({ ...p, [ev.id]: !p[ev.id] }))}
                        className={cn(
                          "w-full flex items-start justify-between gap-3 text-left",
                          hasMeta ? "cursor-pointer" : "cursor-default",
                        )}
                      >
                        <span className="flex items-start gap-2 text-sm">
                          <span aria-hidden>{eventIcon(ev.kind)}</span>
                          <span>{ev.message}</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {formatEventTime(ev.at)}
                        </span>
                      </button>
                      {hasMeta && isOpen ? (
                        <pre className="mt-1.5 text-[11px] bg-background rounded border p-2 overflow-x-auto whitespace-pre-wrap break-words">
                          {JSON.stringify(ev.meta, null, 2)}
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {events.length > 0 && !exhausted ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => {
                  const last = events[events.length - 1];
                  if (last) void load(last.at);
                }}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                Pokaż starsze
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Per-product search results panel.
// ---------------------------------------------------------------------------
type SearchVariantResult = {
  url: string;
  title?: string;
  snippet?: string;
  domain?: string;
  providers?: Array<"firecrawl" | "apify">;
  ai_pick?: boolean;
  ai_reason?: string;
  filtered_out?: "marketplace" | "host_dup";
  scraped?: boolean;
};
type SearchVariantBucket = {
  variant: string;
  kind: string;
  providers?: { firecrawl?: number; apify?: number };
  results: SearchVariantResult[];
};

function ProductSearchResults({
  projectId,
  productId,
  productName,
}: { projectId: string; productId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const [rediscovering, setRediscovering] = useState(false);
  const startDiscovery = useServerFn(startFirecrawlDiscovery);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["search-results", projectId, productName],
    enabled: open && !!productName,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("search_results")
        .select("term, organic_urls, query_variants, created_at")
        .eq("project_id", projectId)
        .eq("term", productName)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const row = (data ?? [])[0];
      if (!row) return null;
      const variants = Array.isArray(row.query_variants) ? (row.query_variants as unknown as SearchVariantBucket[]) : [];
      return { variants, createdAt: row.created_at as string };
    },
  });

  async function onRediscover() {
    setRediscovering(true);
    try {
      await startDiscovery({ data: { projectId, productIds: [productId], onlyMissing: false } });
      toast.success("Uruchomiono ponowne wyszukiwanie w tle");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["search-results", projectId, productName] }), 4000);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić wyszukiwania"));
    } finally {
      setRediscovering(false);
    }
  }

  const providerBadge = (p: "firecrawl" | "apify") => (
    <span
      key={p}
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded border",
        p === "firecrawl" ? "bg-sky-500/10 border-sky-500/30 text-sky-700" : "bg-amber-500/10 border-amber-500/30 text-amber-700",
      )}
    >
      {p === "firecrawl" ? "Firecrawl" : "Apify"}
    </span>
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-6">
      <Card>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="cursor-pointer">
            <CardTitle className="flex items-center gap-2 text-base">
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
              Wyniki wyszukiwania
              <span className="text-xs text-muted-foreground font-normal ml-auto">
                {q.data ? `${q.data.variants.reduce((s, v) => s + v.results.length, 0)} wyników` : ""}
              </span>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Surowe wyniki SERP dla wariantów zapytań (Firecrawl + Apify). Znaczniki: [wybrane przez AI], [scrapowane], [odfiltrowane].
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={onRediscover} disabled={rediscovering}>
                  {rediscovering ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                  Szukaj ponownie
                </Button>
              </div>
            </div>
            {q.isLoading ? (
              <p className="text-sm text-muted-foreground">Ładuję…</p>
            ) : !q.data ? (
              <p className="text-sm text-muted-foreground">Brak zapisanych wyników wyszukiwania dla tego produktu.</p>
            ) : q.data.variants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zapisano wynik, ale bez rozbicia na warianty (stary format).</p>
            ) : (
              q.data.variants.map((b, bi) => (
                <div key={bi} className="rounded border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">[{b.kind}]</Badge>
                    <span className="text-sm font-medium">„{b.variant}"</span>
                    <span className="text-xs text-muted-foreground">
                      {b.results.length} wyników
                      {b.providers?.firecrawl != null ? ` · Firecrawl: ${b.providers.firecrawl}` : ""}
                      {b.providers?.apify != null ? ` · Apify: ${b.providers.apify}` : ""}
                    </span>
                  </div>
                  <ol className="space-y-1.5 text-xs">
                    {b.results.map((r, ri) => (
                      <li key={ri} className={cn("flex flex-col gap-0.5", r.filtered_out && "opacity-60")}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <a href={r.url} target="_blank" rel="noreferrer" className="font-medium underline break-all">
                            {r.title || r.url}
                          </a>
                          {(r.providers ?? []).map(providerBadge)}
                          {r.ai_pick ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-700" title={r.ai_reason}>
                              wybrane przez AI
                            </span>
                          ) : null}
                          {r.scraped ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-violet-500/10 border-violet-500/30 text-violet-700">
                              scrapowane
                            </span>
                          ) : null}
                          {r.filtered_out ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted text-muted-foreground">
                              odfiltrowane ({r.filtered_out === "marketplace" ? "marketplace" : "duplikat hosta"})
                            </span>
                          ) : null}
                        </div>
                        {r.snippet ? <div className="text-muted-foreground line-clamp-2">{r.snippet}</div> : null}
                        <div className="text-[10px] text-muted-foreground">{r.domain}</div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}