import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { toast } from "sonner";
import { getProject, updateProject } from "@/lib/pim/projects.functions";
import {
  ingestSearchResults,
  ingestProductSources,
  clearProjectData,
  reclassifyVariants,
} from "@/lib/pim/ingest.functions";
import { runMatching } from "@/lib/pim/matching.functions";
import { listProductsWithEnrichment, getPipelineSummary } from "@/lib/pim/queries.functions";
import { generateGoldenRecord, verifySources } from "@/lib/pim/ai.functions";
import { exportProject } from "@/lib/pim/export.functions";
import { parseSearchJson, parseProductJson } from "@/lib/pim/parsers";
import { hideImageByProduct } from "@/lib/pim/enrichments.functions";
import { supabase } from "@/integrations/supabase/client";
import { setPinnedMainImage } from "@/lib/pim/enrichments.functions";
import { isPipelineEligible } from "@/lib/pim/eligibility";
import { regenerateMainImage } from "@/lib/pim/regen.functions";
import {
  getMediaSettings,
  saveMediaSettings,
  type MainImageRule,
  type MediaSettings,
} from "@/lib/pim/media.functions";
import {
  createBulkJob,
  getActiveBulkJob,
  cancelBulkJob,
} from "@/lib/pim/bulk-jobs.functions";
import {
  startFirecrawlDiscovery,
  recleanProductSources,
  resetProductSources,
} from "@/lib/pim/firecrawl.functions";
import { testApifySerp } from "@/lib/pim/apify.functions";
import { deleteProducts, setProductsExcluded } from "@/lib/pim/products.functions";
import { BulkJobLog } from "@/components/pim/BulkJobLog";
import { FillMissingImagesDialog, type FillTarget } from "@/components/pim/FillMissingImagesDialog";
import { GenerateVisualizationsDialog, type VizTarget } from "@/components/pim/GenerateVisualizationsDialog";
import { ShareProjectDialog } from "@/components/pim/ShareProjectDialog";
import { ClientGuidelinesDialog } from "@/components/pim/ClientGuidelinesDialog";
import { RoundtripExportDialog } from "@/components/pim/RoundtripExportDialog";
import { DetectVariantsDialog } from "@/components/pim/DetectVariantsDialog";
import { MarkAsVariantsDialog } from "@/components/pim/MarkAsVariantsDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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
import { UploadZone } from "@/components/pim/UploadZone";
import { RemapCsvDialog } from "@/components/pim/RemapCsvDialog";
import { ImportCsvDialog } from "@/components/pim/ImportCsvDialog";
import { ImportUrlsDialog } from "@/components/pim/ImportUrlsDialog";
import { PipelineStages, stageToFilter, type StageKey } from "@/components/pim/PipelineStages";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { friendlyError } from "@/lib/utils";
import {
  Sparkles,
  Download,
  Play,
  ArrowLeft,
  Trash2,
  ImageOff,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  X as XIcon,
  Pin,
  PinOff,
  RefreshCw,
  ImagePlus,
  Wand2,
  Share2,
  FileText,
  Lock,
  LockOpen,
  Wrench,
  ChevronDown,
  ClipboardCheck,
} from "lucide-react";
import {
  PIPELINE_STATUS_LABEL,
  type PimPipelineStatus,
} from "@/lib/pim/pipeline-status";
import { setManualLock } from "@/lib/pim/enrichments.functions";
import { approveProduct, unapproveProduct, bulkApprovePass } from "@/lib/pim/review.functions";
import { setMatchingMode, rerunMatchingForProduct } from "@/lib/pim/compat.functions";
import { CheckCircle2, Undo2 } from "lucide-react";

const searchSchema = z.object({
  page: z.number().min(1).catch(1),
  pageSize: z.number().min(1).catch(25),
  filter: z
    .enum([
      "ALL",
      "MATCHED",
      "PENDING",
      "GENERATED",
      "NO_MATCH",
      "NO_IMAGES",
      "POOR_DATA",
      "PIPE_IMPORTED",
      "PIPE_SOURCES_FOUND",
      "PIPE_MATCHED",
      "PIPE_GOLDEN_READY",
      "PIPE_VISUALS_READY",
      "REVIEW",
      "LOCKED",
      "EXCLUDED",
      "VARIANTS",
    ])
    .catch("ALL"),
  search: z.string().catch(""),
  category: z.string().catch(""),
  stage: z
    .enum(["NONE", "IMPORT", "SOURCES", "MATCH", "CONTENT", "MEDIA", "REVIEW"])
    .catch("NONE"),
});

export const Route = createFileRoute("/_auth/projects/$id/")({
  validateSearch: searchSchema,
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const getFn = useServerFn(getProject);
  const updFn = useServerFn(updateProject);
  const ingSrFn = useServerFn(ingestSearchResults);
  const ingPsFn = useServerFn(ingestProductSources);
  const clearFn = useServerFn(clearProjectData);
  const matchFn = useServerFn(runMatching);
  const listFn = useServerFn(listProductsWithEnrichment);
  const genFn = useServerFn(generateGoldenRecord);
  const verifyFn = useServerFn(verifySources);
  const exportFn = useServerFn(exportProject);
  const hideImgFn = useServerFn(hideImageByProduct);
  const pinFn = useServerFn(setPinnedMainImage);
  const regenFn = useServerFn(regenerateMainImage);
  const getMediaFn = useServerFn(getMediaSettings);
  const saveMediaFn = useServerFn(saveMediaSettings);
  const createJobFn = useServerFn(createBulkJob);
  const getActiveJobFn = useServerFn(getActiveBulkJob);
  const cancelJobFn = useServerFn(cancelBulkJob);
  const firecrawlFn = useServerFn(startFirecrawlDiscovery);
  const recleanFn = useServerFn(recleanProductSources);
  const resetSourcesFn = useServerFn(resetProductSources);
  const setLockFn = useServerFn(setManualLock);
  const setModeFn = useServerFn(setMatchingMode);
  const rerunMatchFn = useServerFn(rerunMatchingForProduct);
  const deleteProductsFn = useServerFn(deleteProducts);
  const setProductsExcludedFn = useServerFn(setProductsExcluded);
  const summaryFn = useServerFn(getPipelineSummary);
  const approveFn = useServerFn(approveProduct);
  const unapproveFn = useServerFn(unapproveProduct);
  const bulkApprovePassFn = useServerFn(bulkApprovePass);
  const reclassifyFn = useServerFn(reclassifyVariants);

  const runReclassify = async () => {
    try {
      const res = await reclassifyFn({ data: { projectId: id } });
      if (!res.ok) {
        // No column-based hierarchy — fall back to pattern-based detection.
        toast.info("Brak kolumn hierarchii — uruchamiam wykrywanie po wzorcu…");
        setDetectVariantsOpen(true);
        return;
      }
      if (res.reclassified === 0) {
        toast.success(
          `Kolumny hierarchii: ${res.mains} głównych, ${res.variants} wariantów. Sprawdzę też wzorce…`,
        );
        setDetectVariantsOpen(true);
      } else {
        toast.success(
          `Sklasyfikowano: ${res.mains} głównych, ${res.variants} wariantów — przeniesiono ${res.reclassified} do wariantów${res.skippedLocked ? ` (pominięto ${res.skippedLocked} zablokowanych)` : ""}.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["project", id] });
      refetchProducts();
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się wykryć wariantów"));
    }
  };

  const { data: meta } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getFn({ data: { id } }),
  });
  const { data: mediaSettings } = useQuery({
    queryKey: ["project", id, "media-settings"],
    queryFn: () => getMediaFn({ data: { projectId: id } }),
  });
  const { data: products = [], refetch: refetchProducts } = useQuery({
    queryKey: ["project", id, "products"],
    queryFn: () => listFn({ data: { projectId: id } }),
  });
  const { data: summary } = useQuery({
    queryKey: ["project", id, "pipeline-summary"],
    queryFn: () => summaryFn({ data: { projectId: id } }),
    refetchInterval: 8000,
  });

  const navigate = useNavigate();
  const urlSearch = Route.useSearch();

  const filter = urlSearch.filter;
  const search = urlSearch.search;
  const category = urlSearch.category;
  const pageSize = urlSearch.pageSize;
  const page = urlSearch.page;
  const stage = urlSearch.stage;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fillOpen, setFillOpen] = useState(false);
  const [vizOpen, setVizOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyForce, setVerifyForce] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [remapOpen, setRemapOpen] = useState(false);
  const [roundtripOpen, setRoundtripOpen] = useState(false);
  const [detectVariantsOpen, setDetectVariantsOpen] = useState(false);
  const [markVariantsOpen, setMarkVariantsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "one"; id: string; name: string }
    | { kind: "bulk"; ids: string[]; names: string[] }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  const runDelete = async () => {
    if (!deleteTarget) return;
    const ids =
      deleteTarget.kind === "one" ? [deleteTarget.id] : deleteTarget.ids;
    if (!ids.length) return;
    setDeleting(true);
    const t = toast.loading(
      ids.length === 1 ? "Usuwam produkt…" : `Usuwam ${ids.length} produktów…`,
    );
    try {
      // Chunk to stay under the 500-per-call server limit.
      let total = 0;
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const res = await deleteProductsFn({
          data: { projectId: id, productIds: chunk },
        });
        total += res.deleted;
      }
      toast.success(
        total === 1
          ? "Produkt usunięty"
          : `Usunięto ${total} produktów`,
        { id: t },
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const pid of ids) next.delete(pid);
        return next;
      });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["project", id] });
      refetchProducts();
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się usunąć"), { id: t });
    } finally {
      setDeleting(false);
    }
  };

  const updateSearch = (partial: Partial<typeof urlSearch>) => {
    navigate({
      to: ".",
      search: (prev: typeof urlSearch) => ({ ...prev, ...partial }),
    });
  };

  // Active background jobs (server-side, survives browser close).
  const lastTerminalToastRef = useRef<Record<string, string>>({});
  const { data: genJob } = useQuery({
    queryKey: ["project", id, "bulk-job", "GENERATE_GOLDEN"],
    queryFn: () => getActiveJobFn({ data: { projectId: id, kind: "GENERATE_GOLDEN" } }),
    refetchInterval: 3000,
  });
  const { data: regenJob } = useQuery({
    queryKey: ["project", id, "bulk-job", "REGENERATE_MEDIA"],
    queryFn: () => getActiveJobFn({ data: { projectId: id, kind: "REGENERATE_MEDIA" } }),
    refetchInterval: 3000,
  });
  const { data: discJob } = useQuery({
    queryKey: ["project", id, "bulk-job", "FIRECRAWL_DISCOVERY"],
    queryFn: () => getActiveJobFn({ data: { projectId: id, kind: "FIRECRAWL_DISCOVERY" } }),
    refetchInterval: 3000,
  });
  const { data: vizJob } = useQuery({
    queryKey: ["project", id, "bulk-job", "PIM_VISUALIZATIONS"],
    queryFn: () => getActiveJobFn({ data: { projectId: id, kind: "PIM_VISUALIZATIONS" } }),
    refetchInterval: 3000,
  });
  const { data: allegroJob } = useQuery({
    queryKey: ["project", id, "bulk-job", "PIM_ALLEGRO_DESCRIPTION"],
    queryFn: () => getActiveJobFn({ data: { projectId: id, kind: "PIM_ALLEGRO_DESCRIPTION" } }),
    refetchInterval: 3000,
  });
  const { data: verifyJob } = useQuery({
    queryKey: ["project", id, "bulk-job", "PIM_IMAGE_VERIFY"],
    queryFn: () => getActiveJobFn({ data: { projectId: id, kind: "PIM_IMAGE_VERIFY" } }),
    refetchInterval: 3000,
  });
  const { data: auditJob } = useQuery({
    queryKey: ["project", id, "bulk-job", "PIM_AUDIT"],
    queryFn: () => getActiveJobFn({ data: { projectId: id, kind: "PIM_AUDIT" } }),
    refetchInterval: 3000,
  });
  const genActive = genJob && (genJob.status === "PENDING" || genJob.status === "PROCESSING");
  const regenActive = regenJob && (regenJob.status === "PENDING" || regenJob.status === "PROCESSING");
  const discActive = discJob && (discJob.status === "PENDING" || discJob.status === "PROCESSING");
  const vizActive = vizJob && (vizJob.status === "PENDING" || vizJob.status === "PROCESSING");
  const allegroActive = allegroJob && (allegroJob.status === "PENDING" || allegroJob.status === "PROCESSING");
  const verifyActive = verifyJob && (verifyJob.status === "PENDING" || verifyJob.status === "PROCESSING");
  const auditActive = auditJob && (auditJob.status === "PENDING" || auditJob.status === "PROCESSING");

  // Show toast once per terminal job state + refetch products.
  useEffect(() => {
    for (const job of [genJob, regenJob, discJob, vizJob, allegroJob, verifyJob, auditJob]) {
      if (!job) continue;
      if (job.status !== "COMPLETED" && job.status !== "CANCELLED" && job.status !== "FAILED") continue;
      if (lastTerminalToastRef.current[job.id] === job.status) continue;
      lastTerminalToastRef.current[job.id] = job.status;
      const label =
        job.kind === "GENERATE_GOLDEN"
          ? "Generacja złotych rekordów"
          : job.kind === "REGENERATE_MEDIA"
            ? "Regeneracja zdjęć"
            : job.kind === "FIRECRAWL_DISCOVERY"
              ? "Wyszukiwanie źródeł (Firecrawl)"
              : job.kind === "PIM_ALLEGRO_DESCRIPTION"
                ? "Opisy Allegro"
                : job.kind === "PIM_RESCRAPE"
                  ? "Doscrapowanie źródeł"
                  : job.kind === "PIM_IMAGE_VERIFY"
                    ? "Weryfikacja zdjęć AI"
                    : job.kind === "PIM_AUDIT"
                      ? "Audyt AI"
                      : "Wizualizacje produktowe";
      if (job.status === "COMPLETED") {
        toast.success(`${label}: gotowe ${job.processed_count}/${job.total}${job.failed_count ? `, ${job.failed_count} błędów` : ""}`);
      } else if (job.status === "CANCELLED") {
        toast.info(`${label}: zatrzymano ${job.processed_count}/${job.total}`);
      } else {
        toast.error(`${label}: nie powiodło się — ${job.last_error ?? "?"}`);
      }
      refetchProducts();
    }
  }, [genJob, regenJob, discJob, vizJob, allegroJob, verifyJob, auditJob, refetchProducts]);

  useEffect(() => {
    if (!vizActive) return;
    const timer = window.setInterval(() => {
      refetchProducts();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [vizActive, refetchProducts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const isExcluded = !!(p as { excluded?: boolean }).excluded;
      const excludedReason = (p as { excluded_reason?: string | null }).excluded_reason ?? null;
      const isVariant =
        ((p as { row_kind?: string | null }).row_kind ?? "main") === "variant" ||
        excludedReason === "variant";
      if (filter === "VARIANTS") {
        if (!isVariant) return false;
      } else if (filter === "EXCLUDED") {
        if (!isExcluded || isVariant) return false;
      } else if (isExcluded || isVariant) {
        // Excluded rows are hidden from every other view so they don't
        // muddy stage-based lists or bulk actions.
        return false;
      }
      if (filter === "MATCHED" && p.match_type === "NO_MATCH") return false;
      if (filter === "PENDING" && p.status !== "PENDING") return false;
      if (filter === "GENERATED" && p.status !== "GENERATED") return false;
      if (filter === "NO_MATCH" && p.match_type !== "NO_MATCH") return false;
      if (filter === "NO_IMAGES") {
        const hasAny =
          !!p.thumbnail ||
          !!(p as { regenerated_main_image?: string | null }).regenerated_main_image ||
          (((p as { ai_gallery_urls?: string[] }).ai_gallery_urls?.length) ?? 0) > 0;
        if (hasAny) return false;
      }
      if (filter === "POOR_DATA") {
        const ds = (p as { data_sufficiency?: string | null }).data_sufficiency ?? null;
        if (ds !== "partial" && ds !== "poor") return false;
      }
      if (filter.startsWith("PIPE_")) {
        const target = filter.slice("PIPE_".length);
        const cur = ((p as { pipeline_status?: string | null }).pipeline_status ?? "IMPORTED");
        if (cur !== target) return false;
      }
      if (filter === "LOCKED") {
        if (!(p as { manual_lock?: boolean }).manual_lock) return false;
      }
      if (filter === "REVIEW") {
        const rs = (p as { review_status?: string | null }).review_status ?? "NONE";
        if (rs !== "AI_FLAGGED" && rs !== "NEEDS_REVIEW") return false;
      }
      if (q) {
        const blob = `${p.nazwa ?? ""} ${p.ean ?? ""} ${p.kod ?? ""} ${p.golden_name ?? ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      if (category) {
        const pc = ((p as { category?: string | null }).category ?? "").trim();
        if (!pc) return false;
        // Match exact path OR any parent that starts-with category + " > ".
        if (pc !== category && !pc.startsWith(`${category} > `)) return false;
      }
      return true;
    });
  }, [products, filter, search, category]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = ((p as { category?: string | null }).category ?? "").trim();
      if (!c) continue;
      const parts = c.split(" > ");
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join(" > "));
    }
    return Array.from(set).sort();
  }, [products]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  // Reset page when filter/search/pageSize changes
  useEffect(() => {
    if (page !== 1) updateSearch({ page: 1 });
  }, [filter, search, pageSize, category]);

  const handleStageClick = (s: Exclude<StageKey, "NONE">) => {
    if (stage === s) {
      // Toggle off — clear filter.
      updateSearch({ stage: "NONE", filter: "ALL", page: 1 });
    } else {
      updateSearch({ stage: s, filter: stageToFilter(s), page: 1 });
    }
  };

  const runFirecrawl = async () => {
    if (!confirm("Uruchomić wyszukiwanie źródeł przez Firecrawl dla produktów bez źródeł?")) return;
    try {
      const res = await firecrawlFn({ data: { projectId: id, onlyMissing: true } });
      toast.success(`Uruchomiono w tle: ${res.total} produktów.`);
      qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "FIRECRAWL_DISCOVERY"] });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić wyszukiwania"));
    }
  };

  const runReclean = async () => {
    try {
      const res = await recleanFn({ data: { projectId: id } });
      toast.success(
        `Wyczyszczono: ${res.updated}/${res.scanned} źródeł, usunięto ${res.imagesRemoved} zdjęć i ${res.charsRemoved} znaków opisu.`,
      );
      qc.invalidateQueries({ queryKey: ["project", id] });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się wyczyścić źródeł"));
    }
  };

  const runResetSources = async () => {
    if (
      !confirm(
        "Zresetować źródła dla całego projektu?\n\nUsunie wpisy wyszukiwania i wróci wszystkie produkty na etap Import. Nie ruszy blokad ręcznych ani statusów zatwierdzenia.",
      )
    )
      return;
    try {
      const res = await resetSourcesFn({ data: { projectId: id } });
      toast.success(
        `Zresetowano ${res.products} produkt(ów): usunięto ${res.deletedSearchRows} wpisów wyszukiwania.`,
      );
      qc.invalidateQueries({ queryKey: ["project", id] });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się zresetować źródeł"));
    }
  };

  const handleStagePrimary = (s: Exclude<StageKey, "NONE">) => {
    switch (s) {
      case "IMPORT":
        // Ensure Import cards are visible.
        if (stage !== "IMPORT") updateSearch({ stage: "IMPORT", filter: "ALL", page: 1 });
        break;
      case "SOURCES":
        void runFirecrawl();
        break;
      case "MATCH":
        matchMut.mutate();
        break;
      case "CONTENT":
        void generateAll();
        break;
      case "MEDIA":
        void regenerateAll();
        break;
      case "REVIEW":
        // If any eligible product still lacks an audit, prompt Audyt AI
        // first — it flags issues before the human review pass. Otherwise
        // fall through to the classic image-verification dialog.
        if (
          summary &&
          Math.max(0, (summary.audit_eligible ?? 0) - (summary.audit_completed ?? 0)) > 0
        ) {
          void auditAll();
        } else {
          setVerifyOpen(true);
        }
        break;
    }
  };

  const toggleSelected = (pid: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
  const someVisibleSelected =
    !allVisibleSelected && filtered.some((p) => selectedIds.has(p.id));
  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const p of filtered) next.delete(p.id);
      } else {
        for (const p of filtered) next.add(p.id);
      }
      return next;
    });
  };
  const clearSelected = () => setSelectedIds(new Set());

  // ---- Uploads ----

  const handleSearchJson = async (file: File) => {
    const text = await file.text();
    const json = JSON.parse(text);
    const rows = parseSearchJson(json);
    if (!rows.length) throw new Error("Nie znaleziono wyników wyszukiwania");
    await clearFn({ data: { projectId: id, scope: "search_results" } });
    const batchSize = 1500;
    for (let i = 0; i < rows.length; i += batchSize) {
      await ingSrFn({ data: { projectId: id, rows: rows.slice(i, i + batchSize) } });
    }
    toast.success(`Wczytano ${rows.length} zapytań`);
    qc.invalidateQueries({ queryKey: ["project", id] });
  };

  const handleProductsJson = async (file: File) => {
    const text = await file.text();
    const json = JSON.parse(text);
    const rows = parseProductJson(json);
    if (!rows.length) throw new Error("Nie znaleziono produktów źródłowych");
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      await ingPsFn({ data: { projectId: id, rows: rows.slice(i, i + batchSize) } });
    }
    toast.success(`Wczytano ${rows.length} stron produktowych`);
    qc.invalidateQueries({ queryKey: ["project", id] });
  };

  // ---- Actions ----

  const matchMut = useMutation({
    mutationFn: () => matchFn({ data: { projectId: id } }),
    onSuccess: (res) => {
      toast.success(`Dopasowano ${res.matched}/${res.total ?? "?"} produktów`);
      refetchProducts();
      qc.invalidateQueries({ queryKey: ["project", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const generateAll = async (productIds?: string[]) => {
    const idSet = productIds ? new Set(productIds) : null;
    const workflow = (summary?.workflow ?? "full");
    const targets = products.filter((p) => {
      if (idSet && !idSet.has(p.id)) return false;
      if ((p as { row_kind?: string | null }).row_kind === "variant") return false;
      if ((p as { excluded?: boolean | null }).excluded) return false;
      if (workflow === "content_only") {
        // No source dependency — anything not yet generated is a target.
        if (idSet) return true;
        return p.status !== "GENERATED";
      }
      if (idSet) return p.match_type !== "NO_MATCH";
      return p.match_type !== "NO_MATCH" && p.status !== "GENERATED";
    });
    if (!targets.length) {
      toast.info("Brak produktów do wygenerowania");
      return;
    }
    try {
      await createJobFn({
        data: { projectId: id, kind: "GENERATE_GOLDEN", items: targets.map((t) => t.id) },
      });
      toast.success(`Uruchomiono w tle: ${targets.length} produktów. Możesz zamknąć kartę.`);
      qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "GENERATE_GOLDEN"] });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić zadania"));
    }
  };

  const generateAllegroAll = async (productIds?: string[]) => {
    const idSet = productIds ? new Set(productIds) : null;
    const source = idSet ? products.filter((p) => idSet.has(p.id)) : filtered;
    const targets = source.filter(
      (p) => !!(p as { enrichment_id?: string | null }).enrichment_id && p.status === "GENERATED",
    );
    if (!targets.length) {
      toast.info("Brak produktów ze złotym rekordem — najpierw wygeneruj złote rekordy.");
      return;
    }
    try {
      await createJobFn({
        data: { projectId: id, kind: "PIM_ALLEGRO_DESCRIPTION", items: targets.map((t) => t.id) },
      });
      toast.success(`Uruchomiono w tle: opisy Allegro dla ${targets.length} produktów.`);
      qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "PIM_ALLEGRO_DESCRIPTION"] });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić zadania"));
    }
  };

  const regenerateAll = async (productIds?: string[]) => {
    const idSet = productIds ? new Set(productIds) : null;
    const source = idSet ? products.filter((p) => idSet.has(p.id)) : filtered;
    const targets = source.filter(
      (p) =>
        isPipelineEligible(p as { excluded?: boolean | null; row_kind?: string | null }) &&
        !!(p as { enrichment_id?: string | null }).enrichment_id &&
        (p as { regenerated_main_image?: string | null }).regenerated_main_image !== "__imported__",
    );
    if (!targets.length) {
      toast.info("Brak produktów do regeneracji");
      return;
    }
    if (!mediaSettings?.component_a?.trim()) {
      toast.error("Skonfiguruj Komponent A w Ustawieniach → Zdjęcia AI");
      return;
    }
    const max = mediaSettings.max_gallery_images ?? 0;
    if (!confirm(`Zregenerować zdjęcia dla ${targets.length} produktów? Do ${1 + max} generacji FAL na produkt.`)) return;
    try {
      await createJobFn({
        data: { projectId: id, kind: "REGENERATE_MEDIA", items: targets.map((t) => t.id) },
      });
      toast.success(`Uruchomiono w tle: ${targets.length} produktów. Możesz zamknąć kartę.`);
      qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "REGENERATE_MEDIA"] });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić zadania"));
    }
  };

  // Bulk AI image identity verification. Operates on the current selection
  // (or the filtered view). Products without picked_urls are skipped by the
  // worker itself; we still send them so the log shows the skip.
  const verifyImagesAll = async (opts: { force: boolean; productIds?: string[] }) => {
    const idSet = opts.productIds ? new Set(opts.productIds) : null;
    const source = idSet ? products.filter((p) => idSet.has(p.id)) : filtered;
    const targets = source.filter(
      (p) =>
        isPipelineEligible(p as { excluded?: boolean | null; row_kind?: string | null }) &&
        !!(p as { enrichment_id?: string | null }).enrichment_id,
    );
    if (!targets.length) {
      toast.info("Brak produktów z dopasowaniem — najpierw uruchom Dopasowanie.");
      return;
    }
    try {
      await createJobFn({
        data: {
          projectId: id,
          kind: "PIM_IMAGE_VERIFY",
          items: targets.map((t) => t.id),
          payload: { force: opts.force },
        },
      });
      toast.success(`Uruchomiono weryfikację zdjęć AI: ${targets.length} produktów.`);
      qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "PIM_IMAGE_VERIFY"] });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić zadania"));
    }
  };

  /**
   * Bulk AI audit — deterministic checks + LLM cross-check for every product
   * with a Golden Record (pipeline_status GOLDEN_READY or VISUALS_READY).
   * Products still in earlier stages are skipped by the worker itself.
   */
  const auditAll = async (productIds?: string[]) => {
    const idSet = productIds ? new Set(productIds) : null;
    const source = idSet ? products.filter((p) => idSet.has(p.id)) : products;
    const targets = source.filter((p) => {
      const ps = ((p as { pipeline_status?: string | null }).pipeline_status ?? "IMPORTED");
      return ps === "GOLDEN_READY" || ps === "VISUALS_READY";
    });
    if (!targets.length) {
      toast.info("Brak produktów ze złotym rekordem — najpierw wygeneruj złote rekordy.");
      return;
    }
    try {
      await createJobFn({
        data: { projectId: id, kind: "PIM_AUDIT", items: targets.map((t) => t.id) },
      });
      toast.success(`Uruchomiono Audyt AI: ${targets.length} produktów.`);
      qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "PIM_AUDIT"] });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić Audytu AI"));
    }
  };

  const exportFile = async (
    fmt: "csv" | "xlsx",
    approvedOnly = false,
    mode: "client" | "qc" | "delivery" = "client",
    hostImages = false,
  ) => {
    const allRows = await exportFn({ data: { projectId: id, approvedOnly, mode, hostImages } });
    const rows =
      selectedIds.size > 0
        ? (allRows as Array<Record<string, unknown>>).filter((r) => {
            const pid = (r.id ?? r.product_id ?? r.productId) as string | undefined;
            return pid ? selectedIds.has(pid) : true;
          })
        : allRows;
    if (fmt === "csv") {
      const csv =
        "\uFEFF" +
        Papa.unparse(rows, { delimiter: ";", newline: "\r\n", quotes: true });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, `${meta?.project.name ?? "export"}.csv`);
    } else {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "enriched");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      downloadBlob(new Blob([out], { type: "application/octet-stream" }), `${meta?.project.name ?? "export"}.xlsx`);
    }
  };

  return (
    <main className="container mx-auto p-6 max-w-7xl">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/projects"><ArrowLeft className="h-4 w-4 mr-2" /> Wszystkie projekty</Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-serif text-5xl tracking-tight">{meta?.project.name ?? "..."}</h1>
          <p className="text-sm text-muted-foreground">
            {summary?.total ?? meta?.counts.source_products ?? 0} produktów ·{" "}
            {summary ? Math.max(0, summary.total - summary.imported) : (meta?.counts.product_sources ?? 0)} ze źródłami ·{" "}
            {summary ? Math.max(0, summary.total - summary.imported - summary.sources_found - summary.matched) : (meta?.counts.enrichments_done ?? 0)} złotych rekordów ·{" "}
            {summary?.visuals_ready ?? 0} z wizualizacjami
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Wrench className="h-4 w-4 mr-2" /> Narzędzia
                <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Narzędzia</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setGuidelinesOpen(true)}>
                <FileText className="h-4 w-4 mr-2" />
                Wytyczne klienta
                {(() => {
                  const s = (meta?.project as { settings?: { client_guidelines?: string } } | undefined)?.settings;
                  const filled = Boolean(s?.client_guidelines?.trim());
                  return (
                    <span
                      className={`ml-auto inline-block h-2 w-2 rounded-full ${filled ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                    />
                  );
                })()}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void runReclean()}>
                <Sparkles className="h-4 w-4 mr-2" /> Wyczyść śmieci ze źródeł
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void runResetSources()}>
                <Sparkles className="h-4 w-4 mr-2" /> Reset źródeł (wróć na Import)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRemapOpen(true)}>
                <Wand2 className="h-4 w-4 mr-2" /> Uzupełnij dane z CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void runReclassify()}>
                <Wand2 className="h-4 w-4 mr-2" /> Wykryj warianty (ponownie)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void auditAll()}
                disabled={!!auditActive}
              >
                <ClipboardCheck className="h-4 w-4 mr-2" /> Audyt AI
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/projects/$id/verify" params={{ id }}>
                  <ShieldCheck className="h-4 w-4 mr-2" /> Widok weryfikacyjny
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setVerifyOpen(true)}
                disabled={!!verifyActive}
              >
                <RefreshCw className="h-4 w-4 mr-2" /> Weryfikuj zdjęcia AI
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" /> Eksport
                <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Dane produktowe (dla klienta/sklepu)</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportFile("csv", false, "client")}>
                <Download className="h-4 w-4 mr-2" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("xlsx", false, "client")}>
                <Download className="h-4 w-4 mr-2" /> XLSX
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("csv", true, "client")}>
                <Download className="h-4 w-4 mr-2" /> CSV (tylko zatwierdzone)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("xlsx", true, "client")}>
                <Download className="h-4 w-4 mr-2" /> XLSX (tylko zatwierdzone)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Roboczy (z metadanymi QC)</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportFile("csv", false, "qc")}>
                <Download className="h-4 w-4 mr-2" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("xlsx", false, "qc")}>
                <Download className="h-4 w-4 mr-2" /> XLSX
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("csv", true, "qc")}>
                <Download className="h-4 w-4 mr-2" /> CSV (tylko zatwierdzone)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("xlsx", true, "qc")}>
                <Download className="h-4 w-4 mr-2" /> XLSX (tylko zatwierdzone)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Dostawa (tylko nowe dane, trwałe linki)</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportFile("csv", false, "delivery", true)}>
                <Download className="h-4 w-4 mr-2" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("xlsx", false, "delivery", true)}>
                <Download className="h-4 w-4 mr-2" /> XLSX
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("csv", true, "delivery", true)}>
                <Download className="h-4 w-4 mr-2" /> CSV (tylko zatwierdzone)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("xlsx", true, "delivery", true)}>
                <Download className="h-4 w-4 mr-2" /> XLSX (tylko zatwierdzone)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("csv", false, "delivery", false)}>
                <Download className="h-4 w-4 mr-2" /> CSV (bez kopiowania obrazów)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Plik klienta (aktualizacja)</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setRoundtripOpen(true)}>
                <Download className="h-4 w-4 mr-2" /> Round-trip (oryginalny układ)…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => setShareOpen(true)}>
            <Share2 className="h-4 w-4 mr-2" /> Udostępnij klientowi
          </Button>
        </div>
      </div>

      {summary && (
        <PipelineStages
          summary={summary}
          onPrimaryAction={handleStagePrimary}
          onShowPending={(s) => {
            const f = stageToFilter(s);
            updateSearch({ filter: f, stage: "NONE", page: 1 });
          }}
          onRunAudit={() => void auditAll()}
          onShowExcluded={() =>
            updateSearch({ filter: "EXCLUDED", stage: "NONE", page: 1 })
          }
        />
      )}

      {genActive && genJob && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>
                {genJob.cancel_requested ? "Zatrzymywanie… " : "Generacja złotych rekordów "}
                {genJob.processed_count}/{genJob.total} (w tle)
              </span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">{Math.round((genJob.processed_count / Math.max(1, genJob.total)) * 100)}%</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    await cancelJobFn({ data: { jobId: genJob.id } });
                    toast.message("Zatrzymywanie…");
                    qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "GENERATE_GOLDEN"] });
                  }}
                  disabled={genJob.cancel_requested}
                >
                  <XIcon className="h-3 w-3 mr-1" /> Zatrzymaj
                </Button>
              </div>
            </div>
            <Progress value={(genJob.processed_count / Math.max(1, genJob.total)) * 100} />
            <BulkJobLog jobId={genJob.id} />
          </CardContent>
        </Card>
      )}

      {regenActive && regenJob && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>
                {regenJob.cancel_requested ? "Zatrzymywanie… " : "Regeneracja teł "}
                {regenJob.processed_count}/{regenJob.total} (w tle)
              </span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">{Math.round((regenJob.processed_count / Math.max(1, regenJob.total)) * 100)}%</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    await cancelJobFn({ data: { jobId: regenJob.id } });
                    toast.message("Zatrzymywanie…");
                    qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "REGENERATE_MEDIA"] });
                  }}
                  disabled={regenJob.cancel_requested}
                >
                  <XIcon className="h-3 w-3 mr-1" /> Zatrzymaj
                </Button>
              </div>
            </div>
            <Progress value={(regenJob.processed_count / Math.max(1, regenJob.total)) * 100} />
            <BulkJobLog jobId={regenJob.id} />
          </CardContent>
        </Card>
      )}

      {discActive && discJob && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>
                {discJob.cancel_requested ? "Zatrzymywanie… " : "Wyszukiwanie źródeł (Firecrawl) "}
                {discJob.processed_count}/{discJob.total} (w tle)
              </span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">{Math.round((discJob.processed_count / Math.max(1, discJob.total)) * 100)}%</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    await cancelJobFn({ data: { jobId: discJob.id } });
                    toast.message("Zatrzymywanie…");
                    qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "FIRECRAWL_DISCOVERY"] });
                  }}
                  disabled={discJob.cancel_requested}
                >
                  <XIcon className="h-3 w-3 mr-1" /> Zatrzymaj
                </Button>
              </div>
            </div>
            <Progress value={(discJob.processed_count / Math.max(1, discJob.total)) * 100} />
            <BulkJobLog jobId={discJob.id} />
          </CardContent>
        </Card>
      )}

      {vizActive && vizJob && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>
                {vizJob.cancel_requested ? "Zatrzymywanie… " : "Generuję wizualizacje produktowe "}
                {vizJob.processed_count}/{vizJob.total} (w tle)
              </span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">{Math.round((vizJob.processed_count / Math.max(1, vizJob.total)) * 100)}%</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    await cancelJobFn({ data: { jobId: vizJob.id } });
                    toast.message("Zatrzymywanie…");
                    qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "PIM_VISUALIZATIONS"] });
                  }}
                  disabled={vizJob.cancel_requested}
                >
                  <XIcon className="h-3 w-3 mr-1" /> Zatrzymaj
                </Button>
              </div>
            </div>
            <Progress value={(vizJob.processed_count / Math.max(1, vizJob.total)) * 100} />
            <BulkJobLog jobId={vizJob.id} />
          </CardContent>
        </Card>
      )}

      {verifyActive && verifyJob && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>
                {verifyJob.cancel_requested ? "Zatrzymywanie… " : "Weryfikacja zdjęć AI "}
                {verifyJob.processed_count}/{verifyJob.total} (w tle)
              </span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">
                  {Math.round((verifyJob.processed_count / Math.max(1, verifyJob.total)) * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    await cancelJobFn({ data: { jobId: verifyJob.id } });
                    toast.message("Zatrzymywanie…");
                    qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "PIM_IMAGE_VERIFY"] });
                  }}
                  disabled={verifyJob.cancel_requested}
                >
                  <XIcon className="h-3 w-3 mr-1" /> Zatrzymaj
                </Button>
              </div>
            </div>
            <Progress value={(verifyJob.processed_count / Math.max(1, verifyJob.total)) * 100} />
            <BulkJobLog jobId={verifyJob.id} />
          </CardContent>
        </Card>
      )}

      {auditActive && auditJob && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>
                {auditJob.cancel_requested ? "Zatrzymywanie… " : "Audyt AI "}
                {auditJob.processed_count}/{auditJob.total} (w tle)
              </span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">
                  {Math.round((auditJob.processed_count / Math.max(1, auditJob.total)) * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    await cancelJobFn({ data: { jobId: auditJob.id } });
                    toast.message("Zatrzymywanie…");
                    qc.invalidateQueries({ queryKey: ["project", id, "bulk-job", "PIM_AUDIT"] });
                  }}
                  disabled={auditJob.cancel_requested}
                >
                  <XIcon className="h-3 w-3 mr-1" /> Zatrzymaj
                </Button>
              </div>
            </div>
            <Progress value={(auditJob.processed_count / Math.max(1, auditJob.total)) * 100} />
            <BulkJobLog jobId={auditJob.id} />
          </CardContent>
        </Card>
      )}

      {/* Controlled "Uzupełnij dane z CSV" — launched from the Narzędzia dropdown. */}
      <RemapCsvDialog
        projectId={id}
        defaults={{
          id_column: (meta?.project as { settings?: { id_column?: string } } | undefined)?.settings?.id_column,
          name_column: (meta?.project as { settings?: { name_column?: string } } | undefined)?.settings?.name_column,
          code_column: (meta?.project as { settings?: { code_column?: string } } | undefined)?.settings?.code_column,
          ean_column: (meta?.project as { settings?: { ean_column?: string } } | undefined)?.settings?.ean_column,
        }}
        open={remapOpen}
        onOpenChange={setRemapOpen}
        onDone={() => refetchProducts()}
      />

      <Tabs defaultValue="data" className="mb-4">
        <TabsList>
          <TabsTrigger value="data">Dane</TabsTrigger>
          <TabsTrigger value="settings">Ustawienia</TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="space-y-3 pt-3">
          {(stage === "IMPORT" || (meta?.counts.source_products ?? 0) === 0) && (
            <>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            <ImportCsvDialog
              projectId={id}
              count={meta?.counts.source_products}
              defaults={{
                id_column: meta?.project.id_column,
                name_column: meta?.project.name_column,
                code_column: meta?.project.code_column,
                ean_column: meta?.project.ean_column,
              }}
              onDone={() => refetchProducts()}
            />
            <ImportUrlsDialog
              projectId={id}
              onDone={() => refetchProducts()}
            />
            <UploadZone
              title="Search JSON"
              accept=".json,application/json"
              description="Wyniki wyszukiwania Google (searchQuery.term + organicResults)"
              count={meta?.counts.search_results}
              onFile={handleSearchJson}
            />
            <UploadZone
              title="Product JSON"
              accept=".json,application/json"
              description="Zeskrapowane strony produktowe (url, name, description, images)"
              count={meta?.counts.product_sources}
              onFile={handleProductsJson}
            />
          </div>
          <div className="flex items-center justify-between border rounded-lg p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground">
              Brakuje kolumny (np. symbol/kod, EAN) w już zaimportowanych produktach? Dograj ją z CSV bez kasowania danych AI.
            </div>
            <RemapCsvDialog
              projectId={id}
              defaults={{
                id_column: meta?.project.id_column,
                name_column: meta?.project.name_column,
                code_column: meta?.project.code_column,
                ean_column: meta?.project.ean_column,
              }}
              onDone={() => refetchProducts()}
            />
          </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="settings" className="pt-3">
          <SettingsCard
            project={meta?.project}
            mediaSettings={mediaSettings}
            onSaveMedia={async (patch) => {
              await saveMediaFn({ data: { projectId: id, ...patch } });
              toast.success("Zapisano ustawienia AI");
              qc.invalidateQueries({ queryKey: ["project", id, "media-settings"] });
            }}
            onSave={async (patch) => {
              await updFn({ data: { id, ...patch } });
              toast.success("Zapisano");
              qc.invalidateQueries({ queryKey: ["project", id] });
            }}
          />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Produkty</CardTitle>
          <div className="flex gap-2">
            <Input
              placeholder="Szukaj nazwa/EAN/kod..."
              value={search}
              onChange={(e) => updateSearch({ search: e.target.value })}
              className="w-64"
            />
            <Select
              value={filter}
              onValueChange={(v) => updateSearch({ filter: v as typeof filter, stage: "NONE" })}
            >
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Wszystkie</SelectItem>
                <SelectItem value="PIPE_IMPORTED">Bez źródeł (do wyszukania)</SelectItem>
                <SelectItem value="PIPE_SOURCES_FOUND">Do dopasowania</SelectItem>
                <SelectItem value="PIPE_MATCHED">Do generacji treści</SelectItem>
                <SelectItem value="PIPE_GOLDEN_READY">Do generacji mediów</SelectItem>
                <SelectItem value="REVIEW">Do przeglądu</SelectItem>
                <SelectItem value="NO_IMAGES">Bez zdjęć</SelectItem>
                <SelectItem value="LOCKED">🔒 Zablokowane ręcznie</SelectItem>
                <SelectItem value="EXCLUDED">🚫 Wykluczone (poza procesem)</SelectItem>
                <SelectItem value="VARIANTS">🧬 Warianty</SelectItem>
              </SelectContent>
            </Select>
            {categoryOptions.length > 0 && (
              <Select
                value={category || "__ALL__"}
                onValueChange={(v) => updateSearch({ category: v === "__ALL__" ? "" : v })}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Kategoria" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="__ALL__">Wszystkie kategorie</SelectItem>
                  {categoryOptions.map((c) => {
                    const depth = c.split(" > ").length - 1;
                    const leaf = c.split(" > ").pop() ?? c;
                    return (
                      <SelectItem key={c} value={c}>
                        <span style={{ paddingLeft: `${depth * 10}px` }} className="text-sm">
                          {leaf}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {stage !== "NONE" && stage !== "IMPORT" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <span>
                Filtr etapu aktywny — akcja poniżej dotyczy widocznych <b>{filtered.length}</b> produktów.
              </span>
              <div className="flex flex-wrap gap-2">
                {stage === "SOURCES" && (
                  <Button size="sm" disabled={!!discActive} onClick={() => void runFirecrawl()}>
                    <Sparkles className="h-4 w-4 mr-1" /> Wyszukaj źródła
                  </Button>
                )}
                {stage === "MATCH" && (
                  <Button size="sm" onClick={() => matchMut.mutate()} disabled={matchMut.isPending}>
                    <Play className="h-4 w-4 mr-1" /> Dopasuj
                  </Button>
                )}
                {stage === "CONTENT" && (
                  <Button
                    size="sm"
                    disabled={!!genActive}
                    onClick={() => generateAll(filtered.map((p) => p.id))}
                  >
                    <Sparkles className="h-4 w-4 mr-1" /> Generuj złote rekordy
                  </Button>
                )}
                {stage === "MEDIA" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!regenActive}
                      onClick={() => regenerateAll(filtered.map((p) => p.id))}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" /> Regeneruj tła
                    </Button>
                    <Button size="sm" onClick={() => setVizOpen(true)} disabled={!!vizActive}>
                      <Sparkles className="h-4 w-4 mr-1" /> Wizualizacje
                    </Button>
                  </>
                )}
                {stage === "REVIEW" && (
                  <>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/projects/$id/verify" params={{ id }}>
                        <ShieldCheck className="h-4 w-4 mr-1" /> Widok weryfikacyjny
                      </Link>
                    </Button>
                    <Button size="sm" onClick={() => setVerifyOpen(true)} disabled={!!verifyActive}>
                      <RefreshCw className="h-4 w-4 mr-1" /> Weryfikuj zdjęcia AI
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {selectedIds.size > 0 && (
            <div className="sticky top-0 z-20 -mx-6 px-6 py-2 mb-3 bg-primary/10 border-y border-primary/30 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                Zaznaczono {selectedIds.size}{" "}
                {selectedIds.size === 1 ? "produkt" : "produktów"}
              </span>
              <Button size="sm" variant="ghost" onClick={clearSelected}>
                <XIcon className="h-4 w-4 mr-1" /> Wyczyść
              </Button>
              <div className="flex-1" />
              <Button
                size="sm"
                onClick={() => generateAll([...selectedIds])}
                disabled={!!genActive}
              >
                <Sparkles className="h-4 w-4 mr-1" /> Generuj złote rekordy
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => regenerateAll([...selectedIds])}
                disabled={!!regenActive}
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Regeneruj tła
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFillOpen(true)}
                disabled={!!regenActive || !!discActive}
              >
                <ImagePlus className="h-4 w-4 mr-1" /> Uzupełnij zdjęcia
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setVizOpen(true)}
                disabled={!!vizActive}
              >
                <Sparkles className="h-4 w-4 mr-1" /> Wizualizacje
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setVerifyOpen(true)}
                disabled={!!verifyActive}
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Weryfikuj zdjęcia AI
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => generateAllegroAll([...selectedIds])}
                disabled={!!allegroActive}
              >
                <Sparkles className="h-4 w-4 mr-1" /> {allegroActive ? "Allegro…" : "Opisy Allegro"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const ids = [...selectedIds];
                  if (!ids.length) return;
                  // Toggle mode based on majority; if any is strict → set all to compatible, else back to strict.
                  const anyStrict = products.some(
                    (p) => selectedIds.has(p.id) && (((p as { matching_mode?: string | null }).matching_mode ?? "strict") === "strict"),
                  );
                  const next: "strict" | "compatible" = anyStrict ? "compatible" : "strict";
                  try {
                    await setModeFn({ data: { productIds: ids, mode: next } });
                    toast.success(
                      next === "compatible"
                        ? `Ustawiono tryb zamiennik dla ${ids.length}`
                        : `Ustawiono tryb ścisły dla ${ids.length}`,
                    );
                    refetchProducts();
                  } catch (e) {
                    toast.error(friendlyError(e, "Nie udało się zmienić trybu"));
                  }
                }}
              >
                Tryb: zamiennik/ścisły
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportFile("csv")}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportFile("xlsx")}>
                <Download className="h-4 w-4 mr-1" /> XLSX
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const ids = [...selectedIds];
                  if (!ids.length) return;
                   const restore = filter === "EXCLUDED" || filter === "VARIANTS";
                  try {
                    const res = await setProductsExcludedFn({
                      data: { projectId: id, productIds: ids, excluded: !restore },
                    });
                    toast.success(
                      restore
                        ? `Przywrócono do procesu: ${res.updated}`
                        : `Wykluczono z procesu: ${res.updated}`,
                    );
                    clearSelected();
                    refetchProducts();
                    qc.invalidateQueries({ queryKey: ["project", id, "pipeline-summary"] });
                  } catch (e) {
                    toast.error(friendlyError(e, "Nie udało się zmienić statusu"));
                  }
                }}
              >
                {filter === "EXCLUDED" || filter === "VARIANTS" ? "↩ Przywróć do przetwarzania" : "🚫 Wyklucz z przetwarzania"}
              </Button>
              {filter !== "EXCLUDED" && filter !== "VARIANTS" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMarkVariantsOpen(true)}
                  disabled={selectedIds.size === 0}
                >
                  Oznacz jako warianty produktu…
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  const ids = [...selectedIds];
                  const names = products
                    .filter((p) => selectedIds.has(p.id))
                    .map((p) => p.golden_name ?? p.nazwa ?? p.id);
                  setDeleteTarget({ kind: "bulk", ids, names });
                }}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Usuń zaznaczone
              </Button>
            </div>
          )}
          {filter === "REVIEW" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                Masowe zatwierdzanie produktów z audytem <b>Pass</b>. Pomija już zatwierdzone.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-500/60 text-emerald-700 dark:text-emerald-300"
                onClick={async () => {
                  const ids = selectedIds.size > 0 ? [...selectedIds] : undefined;
                  const t = toast.loading("Zatwierdzam produkty z Pass…");
                  try {
                    const res = await bulkApprovePassFn({ data: { projectId: id, productIds: ids } });
                    toast.success(
                      res.approved === 0
                        ? "Brak produktów z audytem Pass do zatwierdzenia"
                        : `Zatwierdzono ${res.approved} produkt${res.approved === 1 ? "" : "ów"}`,
                      { id: t },
                    );
                    refetchProducts();
                    qc.invalidateQueries({ queryKey: ["project", id, "pipeline-summary"] });
                  } catch (e) {
                    toast.error(friendlyError(e, "Nie udało się zatwierdzić"), { id });
                  }
                }}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" /> Zatwierdź wszystkie z wynikiem Pass
              </Button>
            </div>
          )}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        allVisibleSelected
                          ? true
                          : someVisibleSelected
                          ? "indeterminate"
                          : false
                      }
                      onCheckedChange={toggleAllVisible}
                      aria-label="Zaznacz wszystkie"
                    />
                  </TableHead>
                  <TableHead className="w-44">Zdjęcia</TableHead>
                  <TableHead>Nazwa</TableHead>
                  <TableHead>EAN / Kod</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {filter !== "ALL" ? (
                        <div className="flex flex-col items-center gap-3">
                          <span>Brak produktów na tym etapie — wszystko zrobione ✅</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateSearch({ filter: "ALL", stage: "NONE", page: 1 })}
                          >
                            Pokaż wszystkie
                          </Button>
                        </div>
                      ) : (
                        "Brak produktów do wyświetlenia"
                      )}
                    </TableCell>
                  </TableRow>
                )}
                {paged.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(p.id)}
                        onCheckedChange={() => toggleSelected(p.id)}
                        aria-label={`Zaznacz ${p.nazwa ?? p.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <ProductThumbs
                        productId={p.id}
                        images={p.images ?? []}
                        extraImages={(p as { extra_image_urls?: string[] }).extra_image_urls ?? []}
                        pinnedUrl={(p as { pinned_main_url?: string | null }).pinned_main_url ?? null}
                        enrichmentId={(p as { enrichment_id?: string | null }).enrichment_id ?? null}
                        onPin={async (url) => {
                          const enId = (p as { enrichment_id?: string | null }).enrichment_id;
                          if (!enId) {
                            toast.error("Najpierw dopasuj i wygeneruj");
                            return;
                          }
                          await pinFn({ data: { enrichmentId: enId, url } });
                          toast.success(url ? "Ustawiono główne zdjęcie" : "Odpięto główne zdjęcie");
                          refetchProducts();
                        }}
                        onHide={async (url) => {
                          await hideImgFn({ data: { productId: p.id, url } });
                          toast.success("Zdjęcie ukryte");
                          refetchProducts();
                        }}
                      />
                      {(((p as { unsure_count?: number }).unsure_count ?? 0) +
                        ((p as { rejected_count?: number }).rejected_count ?? 0)) > 0 && (
                        <Link
                          to="/projects/$id/products/$pid"
                          params={{ id, pid: p.id }}
                          className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                          title="Zdjęcia oczekujące weryfikacji / odrzucone przez AI"
                        >
                          {((p as { unsure_count?: number }).unsure_count ?? 0) > 0 && (
                            <span>?{(p as { unsure_count?: number }).unsure_count}</span>
                          )}
                          {((p as { rejected_count?: number }).rejected_count ?? 0) > 0 && (
                            <span>×{(p as { rejected_count?: number }).rejected_count}</span>
                          )}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium line-clamp-1">{p.golden_name ?? p.nazwa ?? "—"}</div>
                      {p.golden_name && p.nazwa && (
                        <div className="text-xs text-muted-foreground line-clamp-1">{p.nazwa}</div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {((p as { category?: string | null }).category ?? "").trim() && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 text-muted-foreground"
                            title={(p as { category?: string | null }).category ?? ""}
                          >
                            {(((p as { category?: string | null }).category ?? "").split(" > ").pop() ?? "").trim()}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                          title="Etap procesu"
                        >
                          {PIPELINE_STATUS_LABEL[
                            (((p as { pipeline_status?: string | null }).pipeline_status ?? "IMPORTED") as PimPipelineStatus)
                          ] ?? "Zaimportowany"}
                        </Badge>
                        {(() => {
                          const rk = (p as { row_kind?: string | null }).row_kind ?? "main";
                          const reason = (p as { excluded_reason?: string | null }).excluded_reason;
                          if (rk === "variant" || reason === "variant") {
                            const parent = (p as { parent_sku?: string | null }).parent_sku;
                            return (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                                title={parent ? `Wariant produktu ${parent}` : "Wariant produktu — pomijany przez pipeline"}
                              >
                                🧬 Wariant{parent ? ` · ${parent}` : ""}
                              </Badge>
                            );
                          }
                          if ((p as { excluded?: boolean }).excluded) {
                            return (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-zinc-500/60 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300"
                                title="Produkt wyłączony z procesu"
                              >
                                🚫 Poza procesem
                              </Badge>
                            );
                          }
                          return null;
                        })()}
                        <button
                          type="button"
                          className={
                            (p as { manual_lock?: boolean }).manual_lock
                              ? "inline-flex items-center gap-1 rounded border border-amber-500/60 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300"
                              : "inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground hover:bg-muted"
                          }
                          title={
                            (p as { manual_lock?: boolean }).manual_lock
                              ? "Zablokowane ręcznie — workery pomijają ten produkt. Kliknij, aby odblokować."
                              : "Zablokuj ręcznie, aby workery nie nadpisywały zmian."
                          }
                          onClick={async (e) => {
                            e.stopPropagation();
                            const locked = !(p as { manual_lock?: boolean }).manual_lock;
                            await setLockFn({ data: { productId: p.id, locked } });
                            toast.success(locked ? "Zablokowano produkt" : "Odblokowano produkt");
                            refetchProducts();
                          }}
                        >
                          {(p as { manual_lock?: boolean }).manual_lock ? (
                            <><Lock className="h-3 w-3" /> Zablokowany</>
                          ) : (
                            <><LockOpen className="h-3 w-3" /> Odblokowany</>
                          )}
                        </button>
                        {(() => {
                          const audit = (p as { audit?: { verdict?: "pass" | "warn" | "fail"; at?: string } | null }).audit;
                          if (!audit) return null;
                          const v = audit.verdict ?? "warn";
                          const cls =
                            v === "pass"
                              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : v === "warn"
                                ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300";
                          const label = v === "pass" ? "Audyt OK" : v === "warn" ? "Audyt: ostrzeżenia" : "Audyt: błędy";
                          return (
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${cls}`}
                              title={audit.at ? `Audyt AI: ${new Date(audit.at).toLocaleString("pl-PL")}` : "Audyt AI"}
                            >
                              <ClipboardCheck className="h-3 w-3 mr-1" /> {label}
                            </Badge>
                          );
                        })()}
                        {(() => {
                          const rs = ((p as { review_status?: string | null }).review_status ?? "NONE") as string;
                          if (rs !== "APPROVED") return null;
                          return (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              title="Produkt zatwierdzony"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Zatwierdzony
                            </Badge>
                          );
                        })()}
                        {(() => {
                          const mm = ((p as { matching_mode?: string | null }).matching_mode ?? "strict") as string;
                          const suggested = !!(p as { compat_suggested?: boolean }).compat_suggested;
                          if (mm === "compatible") {
                            return (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                                title="Dopasowywanie po kompatybilności (zamiennik/akcesorium)"
                              >
                                Zamiennik
                              </Badge>
                            );
                          }
                          if (!suggested) return null;
                          return (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded border border-amber-500/60 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-800 dark:text-amber-300 hover:bg-amber-500/20"
                              title="Wykryto produkt typu zamiennik — kliknij, aby przełączyć tryb i uruchomić ponowne dopasowanie"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await setModeFn({ data: { productIds: [p.id], mode: "compatible" } });
                                  toast.success("Tryb: zamiennik/akcesorium");
                                  await rerunMatchFn({ data: { projectId: id, productId: p.id } }).catch(() => {});
                                  refetchProducts();
                                } catch (err) {
                                  toast.error(friendlyError(err, "Nie udało się przełączyć trybu"));
                                }
                              }}
                            >
                              Zamiennik? →
                            </button>
                          );
                        })()}
                      </div>
                      {(() => {
                        const g = ((p as { ai_gallery_urls?: string[] }).ai_gallery_urls ?? []) as string[];
                        const regen = (p as { regenerated_main_image?: string | null }).regenerated_main_image;
                        const hasRegen = !!regen && regen !== "__imported__";
                        if (!g.length && !hasRegen) return null;
                        return (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {hasRegen && (
                              <div
                                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-700 border-emerald-400/50 dark:text-emerald-300"
                                title="Miniatura zregenerowana (białe tło)"
                              >
                                Miniatura ✓
                              </div>
                            )}
                            {g.length > 0 && (
                              <div className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-700 border-violet-400/50 dark:text-violet-300">
                                <Wand2 className="h-2.5 w-2.5" /> Wizualizacje AI · {g.length}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{p.ean ?? "—"}</div>
                      <div className="text-muted-foreground">{p.kod ?? ""}</div>
                    </TableCell>
                    <TableCell>
                      <MatchBadge type={p.match_type as string} />
                      {(() => {
                        const rounds = (p as { rescrape_rounds?: number }).rescrape_rounds ?? 0;
                        const breakdown = ((p as { score_breakdown?: Array<{ total: number }> }).score_breakdown ?? []) as Array<{ total: number }>;
                        const strong = breakdown.filter((b) => (b?.total ?? 0) >= 4).length;
                        if (rounds < 2 || strong >= 3) return null;
                        return (
                          <Badge
                            variant="outline"
                            className="ml-1 border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            title={`Po ${rounds} rundach doscrapowania nadal ${strong} silnych źródeł (< 3). Rozważ ręczne dodanie linków.`}
                          >
                            Słabe źródła
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title={
                            (p as { regenerated_main_image?: string | null }).regenerated_main_image === "__imported__"
                              ? "Zdjęcie klienta (import) — regeneracja zablokowana"
                              : "Regeneruj tło"
                          }
                          disabled={
                            !((p as { enrichment_id?: string | null }).enrichment_id) ||
                            !(((p as { pinned_main_url?: string | null }).pinned_main_url) || (p.images ?? [])[0]) ||
                            ((p as { regenerated_main_image?: string | null }).regenerated_main_image === "__imported__")
                          }
                          onClick={async () => {
                            const enId = (p as { enrichment_id?: string | null }).enrichment_id;
                            const url = (p as { pinned_main_url?: string | null }).pinned_main_url ?? (p.images ?? [])[0];
                            if (!enId || !url) return;
                            const id = toast.loading("Regeneruję tło...");
                            try {
                              await regenFn({ data: { enrichmentId: enId, imageUrl: url } });
                              toast.success("Wygenerowano", { id });
                              refetchProducts();
                            } catch (e) {
                              toast.error(friendlyError(e, "Regeneracja nie powiodła się"), { id });
                            }
                          }}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/projects/$id/products/$pid" params={{ id, pid: p.id }} search={urlSearch}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                        {(() => {
                          const rs = ((p as { review_status?: string | null }).review_status ?? "NONE") as string;
                          if (rs === "APPROVED") {
                            return (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Cofnij zatwierdzenie"
                                onClick={async () => {
                                  await unapproveFn({ data: { productId: p.id } });
                                  toast.success("Cofnięto zatwierdzenie");
                                  refetchProducts();
                                  qc.invalidateQueries({ queryKey: ["project", id, "pipeline-summary"] });
                                }}
                              >
                                <Undo2 className="h-4 w-4" />
                              </Button>
                            );
                          }
                          return (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Zatwierdź produkt"
                              className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-800"
                              onClick={async () => {
                                await approveFn({ data: { productId: p.id } });
                                toast.success("Zatwierdzono");
                                refetchProducts();
                                qc.invalidateQueries({ queryKey: ["project", id, "pipeline-summary"] });
                              }}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          );
                        })()}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Usuń produkt"
                          className="text-destructive hover:text-destructive"
                          onClick={() =>
                            setDeleteTarget({
                              kind: "one",
                              id: p.id,
                              name: p.golden_name ?? p.nazwa ?? p.id,
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>Wierszy na stronę:</span>
              <Select value={String(pageSize)} onValueChange={(v) => updateSearch({ pageSize: Number(v) })}>
                <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100, 200, 500].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-2">
                {filtered.length === 0
                  ? "0 wyników"
                  : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} z ${filtered.length}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => updateSearch({ page: Math.max(1, currentPage - 1) })}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-muted-foreground">
                Strona {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => updateSearch({ page: Math.min(totalPages, currentPage + 1) })}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <FillMissingImagesDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        projectId={id}
        targets={products
          .filter((p) => selectedIds.has(p.id))
          .map<FillTarget>((p) => ({
            id: p.id,
            picked_urls: (p as { picked_urls?: string[] }).picked_urls ?? [],
            thumbnail: p.thumbnail ?? null,
            regenerated_main_image:
              (p as { regenerated_main_image?: string | null }).regenerated_main_image ?? null,
            ai_gallery_urls: (p as { ai_gallery_urls?: string[] }).ai_gallery_urls ?? [],
          }))}
      />
      <GenerateVisualizationsDialog
        open={vizOpen}
        onOpenChange={setVizOpen}
        projectId={id}
        selectedIds={selectedIds}
        allProducts={products
          .filter((p) =>
            isPipelineEligible(p as { excluded?: boolean | null; row_kind?: string | null }),
          )
          .map<VizTarget>((p) => ({
          id: p.id,
          picked_urls: (p as { picked_urls?: string[] }).picked_urls ?? [],
          regenerated_main_image:
            (p as { regenerated_main_image?: string | null }).regenerated_main_image ?? null,
          pinned_main_url:
            (p as { pinned_main_url?: string | null }).pinned_main_url ?? null,
        }))}
        defaultStylePrompt={
          (meta?.project as { visualization_style_prompt?: string | null } | undefined)
            ?.visualization_style_prompt ?? null
        }
        defaultRequirementsPl={
          (meta?.project as { visualization_requirements_pl?: string | null } | undefined)
            ?.visualization_requirements_pl ?? null
        }
        projectSettings={
          (meta?.project as { settings?: Record<string, unknown> | null } | undefined)
            ?.settings ?? null
        }
      />
      <ShareProjectDialog open={shareOpen} onOpenChange={setShareOpen} projectId={id} />
      <DetectVariantsDialog
        projectId={id}
        open={detectVariantsOpen}
        onOpenChange={setDetectVariantsOpen}
        productsById={new Map(products.map((p) => [p.id, { id: p.id, nazwa: p.nazwa ?? null, kod: p.kod ?? null }]))}
        onDone={() => {
          refetchProducts();
          qc.invalidateQueries({ queryKey: ["project", id, "pipeline-summary"] });
        }}
      />
      <MarkAsVariantsDialog
        projectId={id}
        open={markVariantsOpen}
        onOpenChange={setMarkVariantsOpen}
        selectedIds={[...selectedIds]}
        allProducts={products.map((p) => ({ id: p.id, nazwa: p.nazwa ?? null, kod: p.kod ?? null }))}
        onDone={() => {
          clearSelected();
          refetchProducts();
          qc.invalidateQueries({ queryKey: ["project", id, "pipeline-summary"] });
        }}
      />
      <RoundtripExportDialog
        open={roundtripOpen}
        onOpenChange={setRoundtripOpen}
        projectId={id}
        importMeta={
          ((meta?.project as { settings?: { import_meta?: {
            headers: string[];
            filename: string;
            sheet_name: string | null;
            format: "csv" | "xlsx";
            delimiter: string | null;
          } } } | undefined)?.settings?.import_meta) ?? null
        }
        savedMapping={
          ((meta?.project as { settings?: { roundtrip_mapping?: unknown } } | undefined)
            ?.settings?.roundtrip_mapping as never) ?? null
        }
      />
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="max-w-md">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Weryfikacja zdjęć AI</h3>
            <p className="text-sm text-muted-foreground">
              Gemini Vision sprawdzi każde zdjęcie i oznaczy „ten sam produkt", „inny produkt" lub
              „niepewne". Odrzucone i niepewne nie pojawią się na liście, w eksporcie ani w linku
              klienta. Zdjęcia oznaczone ręcznie jako zatwierdzone są zawsze pomijane.
            </p>
            {(() => {
              const src = selectedIds.size > 0
                ? products.filter((p) => selectedIds.has(p.id))
                : filtered;
              const targets = src.filter((p) => !!(p as { enrichment_id?: string | null }).enrichment_id);
              const total = targets.reduce(
                (n, p) => n + (((p as { total_images?: number }).total_images) ?? 0),
                0,
              );
              const verified = targets.reduce(
                (n, p) => n + (((p as { identity_v2_count?: number }).identity_v2_count) ?? 0),
                0,
              );
              const est = verifyForce ? total : Math.max(0, total - verified);
              return (
                <div className="text-sm rounded border p-2 bg-muted/30">
                  <div>Produktów w zakresie: <b>{targets.length}</b></div>
                  <div>Do analizy: ~<b>{est}</b> zdjęć{verifyForce ? " (wymuszone)" : ""}</div>
                </div>
              );
            })()}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={verifyForce} onCheckedChange={(v) => setVerifyForce(v === true)} />
              Wymuś ponowną analizę już sprawdzonych
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setVerifyOpen(false)}>Anuluj</Button>
              <Button
                onClick={async () => {
                  const ids = selectedIds.size > 0 ? [...selectedIds] : undefined;
                  setVerifyOpen(false);
                  await verifyImagesAll({ force: verifyForce, productIds: ids });
                }}
              >
                Uruchom
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ClientGuidelinesDialog
        open={guidelinesOpen}
        onOpenChange={setGuidelinesOpen}
        projectId={id}
        initialValue={
          ((meta?.project as { settings?: { client_guidelines?: string } } | undefined)?.settings
            ?.client_guidelines ?? "") as string
        }
      />
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === "bulk"
                ? `Usunąć ${deleteTarget.ids.length} produktów?`
                : "Usunąć produkt?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Ta operacja jest nieodwracalna. Usunięte zostaną także złote
                  rekordy, wizualizacje AI i dopasowania dla wskazanych
                  produktów. Źródła (product_sources) i wyniki wyszukiwań
                  pozostają nienaruszone.
                </p>
                {deleteTarget?.kind === "one" && (
                  <p className="text-foreground font-medium line-clamp-2">
                    „{deleteTarget.name}"
                  </p>
                )}
                {deleteTarget?.kind === "bulk" && deleteTarget.names.length > 0 && (
                  <ul className="text-xs text-foreground/80 list-disc pl-5 space-y-0.5">
                    {deleteTarget.names.slice(0, 5).map((n, i) => (
                      <li key={i} className="line-clamp-1">{n}</li>
                    ))}
                    {deleteTarget.names.length > 5 && (
                      <li className="text-muted-foreground">
                        …i {deleteTarget.names.length - 5} więcej
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Usuwam…" : "Usuń"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function MatchBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    EAN_MATCH: { label: "EAN", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
    NAME_MATCH: { label: "Nazwa", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200" },
    HYBRID_MATCH: { label: "Hybrid", cls: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200" },
    NO_MATCH: { label: "Brak", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[type] ?? map.NO_MATCH;
  return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
}

function StatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === "GENERATED") return <Badge className="bg-green-600">Gotowe</Badge>;
  if (status === "FAILED")
    return (
      <Badge variant="destructive" title={error ?? ""}>
        Błąd
      </Badge>
    );
  if (status === "MATCHED") return <Badge variant="outline">Do generacji</Badge>;
  return <Badge variant="secondary">Oczekuje</Badge>;
}

function SettingsCard({
  project,
  onSave,
  mediaSettings,
  onSaveMedia,
}: {
  project?: {
    name: string;
    custom_prompt: string;
    blacklist: string[];
    strategy: string;
    include_extra_images?: boolean;
    code_column?: string;
    ean_column?: string;
    name_column?: string;
    id_column?: string;
    settings?: unknown;
  };
  onSave: (p: {
    name?: string;
    custom_prompt?: string;
    blacklist?: string[];
    strategy?: "EAN" | "NAZWA" | "HYBRID";
    include_extra_images?: boolean;
    code_column?: string;
    ean_column?: string;
    name_column?: string;
    id_column?: string;
    settings?: Record<string, unknown>;
  }) => Promise<void>;
  mediaSettings?: MediaSettings;
  onSaveMedia: (p: Omit<MediaSettings, never>) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [prompt, setPrompt] = useState(project?.custom_prompt ?? "");
  const [blacklist, setBlacklist] = useState((project?.blacklist ?? []).join("\n"));
  const [strategy, setStrategy] = useState<"EAN" | "NAZWA" | "HYBRID">(
    (project?.strategy as "EAN" | "NAZWA" | "HYBRID") ?? "HYBRID",
  );
  const [includeExtra, setIncludeExtra] = useState(project?.include_extra_images ?? false);
  const [idCol, setIdCol] = useState(project?.id_column ?? "");
  const [nameCol, setNameCol] = useState(project?.name_column ?? "");
  const [codeCol, setCodeCol] = useState(project?.code_column ?? "");
  const [eanCol, setEanCol] = useState(project?.ean_column ?? "");
  const initialTrusted = (() => {
    const s = project?.settings;
    if (s && typeof s === "object") {
      const td = (s as Record<string, unknown>).trusted_domains;
      if (Array.isArray(td)) return td.filter((x): x is string => typeof x === "string").join("\n");
    }
    return "";
  })();
  const [trustedDomains, setTrustedDomains] = useState(initialTrusted);

  const initialSearchProvider: "firecrawl" | "apify" | "both" = (() => {
    const s = project?.settings;
    if (s && typeof s === "object") {
      const v = (s as Record<string, unknown>).search_provider;
      if (v === "apify") return "apify";
      if (v === "firecrawl") return "firecrawl";
      if (v === "both") return "both";
    }
    return "both";
  })();
  const [searchProvider, setSearchProvider] = useState<"firecrawl" | "apify" | "both">(initialSearchProvider);
  const initialScrapeCap: number = (() => {
    const s = project?.settings;
    if (s && typeof s === "object") {
      const v = Number((s as Record<string, unknown>).scrape_cap);
      if (Number.isFinite(v)) return Math.max(1, Math.min(12, Math.floor(v)));
    }
    return 6;
  })();
  const [scrapeCap, setScrapeCap] = useState<number>(initialScrapeCap);
  const initialAutoRescrape: boolean = (() => {
    const s = project?.settings;
    if (s && typeof s === "object") {
      const v = (s as Record<string, unknown>).auto_rescrape;
      if (typeof v === "boolean") return v;
    }
    return true;
  })();
  const [autoRescrape, setAutoRescrape] = useState<boolean>(initialAutoRescrape);
  const initialWorkflow: "full" | "content_only" | "media_only" = (() => {
    const s = project?.settings;
    if (s && typeof s === "object") {
      const v = (s as Record<string, unknown>).workflow;
      if (v === "content_only" || v === "media_only" || v === "full") return v;
    }
    return "full";
  })();
  const [workflow, setWorkflow] = useState<"full" | "content_only" | "media_only">(initialWorkflow);
  const [apifyTest, setApifyTest] = useState<{
    state: "idle" | "loading" | "ok" | "err";
    msg?: string;
    locale?: { gl: string; hl: string };
    results?: Array<{ title: string; url: string; domain: string; snippet: string }>;
    count?: number;
    keyword?: string;
    isNumeric?: boolean;
    rawSample?: string;
    inputJson?: string;
  }>({
    state: "idle",
  });
  const [apifyTestQuery, setApifyTestQuery] = useState<string>("filtry do rekuperatora Wanas 350");
  const testApify = useServerFn(testApifySerp);
  const settingsLocale = (() => {
    const s = project?.settings;
    if (s && typeof s === "object") {
      const loc = (s as Record<string, unknown>).serp_locale;
      if (loc && typeof loc === "object") {
        const { gl, hl } = loc as { gl?: unknown; hl?: unknown };
        return {
          gl: typeof gl === "string" && gl.trim() ? gl.trim().toUpperCase() : "PL",
          hl: typeof hl === "string" && hl.trim() ? hl.trim().toLowerCase() : "pl",
        };
      }
    }
    return { gl: "PL", hl: "pl" };
  })();
  const runApifyTest = async () => {
    setApifyTest({ state: "loading" });
    try {
      const q = apifyTestQuery.trim() || "filtry do rekuperatora Wanas 350";
      const r = (await testApify({ data: { query: q, gl: settingsLocale.gl, hl: settingsLocale.hl } })) as {
        ok: boolean;
        count: number;
        results: Array<{ title: string; url: string; domain: string; snippet: string }>;
        gl: string;
        hl: string;
        error?: string;
        keyword: string;
        isNumeric: boolean;
        rawSample?: string;
        inputJson?: string;
      };
      if (r.ok) {
        setApifyTest({
          state: "ok",
          msg: `OK — ${r.count} wyników (gl=${r.gl}, hl=${r.hl})`,
          locale: { gl: r.gl, hl: r.hl },
          results: r.results.map((x) => ({ title: x.title, url: x.url, domain: x.domain, snippet: x.snippet })),
          count: r.count,
          keyword: r.keyword,
          isNumeric: r.isNumeric,
          rawSample: r.rawSample,
          inputJson: r.inputJson,
        });
      } else {
        setApifyTest({
          state: "err",
          msg: `${r.error ?? "Actor nie zwrócił wyników"} (gl=${r.gl}, hl=${r.hl})`,
          locale: { gl: r.gl, hl: r.hl },
          count: r.count,
          keyword: r.keyword,
          isNumeric: r.isNumeric,
          rawSample: r.rawSample,
          inputJson: r.inputJson,
        });
      }
    } catch (e) {
      setApifyTest({ state: "err", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  // Media (AI images) settings.
  const [compA, setCompA] = useState(mediaSettings?.component_a ?? "");
  const [compB, setCompB] = useState(mediaSettings?.component_b ?? "");
  const [rule, setRule] = useState<MainImageRule>(mediaSettings?.main_image_rule ?? "ONLY_A");
  const [resolution, setResolution] = useState<number>(mediaSettings?.target_resolution ?? 2560);
  const [padding, setPadding] = useState<number>(mediaSettings?.padding_percent ?? 70);
  const [maxGallery, setMaxGallery] = useState<number>(mediaSettings?.max_gallery_images ?? 5);
  const [shadow, setShadow] = useState<boolean>(mediaSettings?.apply_shadow ?? true);
  const [styleP, setStyleP] = useState<string>(mediaSettings?.custom_style_prompt ?? "");
  useEffect(() => {
    if (!mediaSettings) return;
    setCompA(mediaSettings.component_a ?? "");
    setCompB(mediaSettings.component_b ?? "");
    setRule(mediaSettings.main_image_rule);
    setResolution(mediaSettings.target_resolution);
    setPadding(mediaSettings.padding_percent);
    setMaxGallery(mediaSettings.max_gallery_images);
    setShadow(mediaSettings.apply_shadow);
    setStyleP(mediaSettings.custom_style_prompt ?? "");
  }, [mediaSettings]);

  // Sync once project loads
  const initialized = useMemo(() => !!project, [project]);
  if (project && !name && !initialized) setName(project.name);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Nazwa</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div>
            <Label>Strategia dopasowania</Label>
            <Select value={strategy} onValueChange={(v) => setStrategy(v as "EAN" | "NAZWA" | "HYBRID")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EAN">EAN — po kodzie EAN</SelectItem>
                <SelectItem value="NAZWA">NAZWA — po nazwie produktu</SelectItem>
                <SelectItem value="HYBRID">HYBRID — Nazwa+EAN, fallback po nazwie/EAN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Custom prompt (instrukcje dla AI)</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="np. Pisz w drugiej osobie, podkreśl zastosowanie sportowe, max 800 znaków."
          />
        </div>
        <div>
          <Label>White-label blacklist (po jednej frazie w linii)</Label>
          <Textarea
            value={blacklist}
            onChange={(e) => setBlacklist(e.target.value)}
            rows={4}
            placeholder={"kaliber.pl\nstrefacelu\nkup teraz\ngwarancja 24m"}
          />
        </div>
        <div>
          <Label>Zaufane domeny (jedna na linię)</Label>
          <p className="text-xs text-muted-foreground mb-1">
            Źródła z tych domen otrzymają bonus +4 do scoringu (np. oficjalny dystrybutor).
          </p>
          <Textarea
            value={trustedDomains}
            onChange={(e) => setTrustedDomains(e.target.value)}
            rows={4}
            placeholder={"producent.pl\ndystrybutor.eu"}
          />
        </div>
        <Button
          onClick={() =>
            onSave({
              name: name.trim(),
              custom_prompt: prompt,
              blacklist: blacklist.split("\n").map((s) => s.trim()).filter(Boolean),
              strategy,
              include_extra_images: includeExtra,
              id_column: idCol.trim(),
              name_column: nameCol.trim(),
              code_column: codeCol.trim(),
              ean_column: eanCol.trim(),
              settings: {
                ...((project?.settings && typeof project.settings === "object") ? (project.settings as Record<string, unknown>) : {}),
                trusted_domains: trustedDomains
                  .split("\n")
                  .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
                  .filter(Boolean),
                search_provider: searchProvider,
                scrape_cap: scrapeCap,
                auto_rescrape: autoRescrape,
                workflow,
              },
            })
          }
        >
          Zapisz
        </Button>
        <div className="pt-4 border-t space-y-2">
          <Label className="text-sm font-medium">Tryb projektu</Label>
          <p className="text-xs text-muted-foreground">
            Steruje widocznością etapów. „Tylko treści" pomija Wyszukiwanie i Dopasowanie — opis generowany jest wyłącznie z danych klienta. „Tylko media" pomija także generację treści.
          </p>
          <div className="flex flex-col gap-2">
            {([
              { v: "full", title: "Pełny proces", desc: "Wyszukiwanie → Dopasowanie → Treści → Media → Review." },
              { v: "content_only", title: "Tylko treści (z danych klienta)", desc: "Pomija discovery i matching; opis generowany z RAW atrybutów klienta." },
              { v: "media_only", title: "Tylko media", desc: "Pomija generację opisów — użyj gdy klient dostarcza własne treści." },
            ] as const).map((o) => (
              <label key={o.v} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="workflow"
                  className="mt-1"
                  checked={workflow === o.v}
                  onChange={() => setWorkflow(o.v)}
                />
                <span>
                  <span className="font-medium">{o.title}</span>
                  <span className="block text-xs text-muted-foreground">{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="pt-4 border-t space-y-2">
          <Label className="text-sm font-medium">Źródło wyszukiwania</Label>
          <p className="text-xs text-muted-foreground">
            Tryb łączony (domyślny) uruchamia oba providery jednocześnie i łączy wyniki. Firecrawl korzysta z własnego indeksu; Google (Apify) używa prawdziwego SERP-a z AI-preselekcją.
          </p>
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="search-provider"
                className="mt-1"
                checked={searchProvider === "both"}
                onChange={() => setSearchProvider("both")}
              />
              <span>
                <span className="font-medium">Łączony (Firecrawl + Google/Apify)</span>
                <span className="block text-xs text-muted-foreground">
                  Rekomendowane. Sumuje wyniki obu źródeł; AI-preselekcja przenosi z Apify tylko trafne pozycje. Wyższy koszt.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="search-provider"
                className="mt-1"
                checked={searchProvider === "firecrawl"}
                onChange={() => setSearchProvider("firecrawl")}
              />
              <span>
                <span className="font-medium">Firecrawl</span>
                <span className="block text-xs text-muted-foreground">Szybkie, tanie, wbudowany index. Do 10 wyników na wariant.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="search-provider"
                className="mt-1"
                checked={searchProvider === "apify"}
                onChange={() => setSearchProvider("apify")}
              />
              <span>
                <span className="font-medium">Google (Apify)</span>
                <span className="block text-xs text-muted-foreground">
                  Actor scraperlink/google-search-results-serp-scraper (~$0.50/1000 SERP). Do ~100 wyników na zapytanie, AI wybiera 12 najbardziej trafnych do scrapowania.
                </span>
              </span>
            </label>
          </div>
          {searchProvider === "apify" || searchProvider === "both" ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  className="h-8 max-w-xs"
                  value={apifyTestQuery}
                  onChange={(e) => setApifyTestQuery(e.target.value)}
                  placeholder="np. 5904905976918 lub nazwa produktu"
                />
                <Button size="sm" variant="secondary" onClick={runApifyTest} disabled={apifyTest.state === "loading"}>
                  {apifyTest.state === "loading" ? "Testuję…" : "Test połączenia Apify"}
                </Button>
                {apifyTest.state === "ok" ? (
                  <span className="text-xs text-emerald-600">{apifyTest.msg}</span>
                ) : apifyTest.state === "err" ? (
                  <span className="text-xs text-destructive">Błąd: {apifyTest.msg}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Uruchamia realne zapytanie do actor-a. Dozwolone są też zapytania czysto numeryczne (EAN).</span>
                )}
              </div>
              {(apifyTest.state === "ok" || apifyTest.state === "err") && apifyTest.keyword ? (
                <div className="rounded border bg-muted/40 p-2 text-xs space-y-1">
                  <div>
                    Zapytanie: <code className="font-mono">{apifyTest.keyword}</code>
                    {apifyTest.isNumeric ? <span className="ml-1 text-amber-600">[numeryczne]</span> : null}
                  </div>
                  <div>Organic count: <span className="font-mono">{apifyTest.count ?? 0}</span></div>
                  {apifyTest.inputJson ? (
                    <div>
                      Input:{" "}
                      <code className="font-mono break-all">{apifyTest.inputJson}</code>
                    </div>
                  ) : null}
                  {apifyTest.rawSample ? (
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">Surowa odpowiedź actor-a (pusty numeric — do 4 KB)</summary>
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px] font-mono">
                        {apifyTest.rawSample}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {apifyTest.state === "ok" && apifyTest.results && apifyTest.results.length > 0 ? (
                <ol className="list-decimal pl-5 space-y-1 text-xs">
                  {apifyTest.results.map((r, i) => (
                    <li key={i}>
                      <a href={r.url} target="_blank" rel="noreferrer" className="font-medium underline">
                        {r.title || r.url}
                      </a>
                      <span className="text-muted-foreground"> — {r.domain}</span>
                      {r.snippet ? <div className="text-muted-foreground line-clamp-2">{r.snippet}</div> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="pt-4 border-t space-y-3">
          <Label className="text-sm font-medium">Budżet scrape'ów</Label>
          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <div>
              <Label className="text-xs">Limit scrape na produkt</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={scrapeCap}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(12, Math.floor(Number(e.target.value) || 6)));
                  setScrapeCap(v);
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Twarda granica prób scrape na produkt (1–12). Pętla kończy się wcześniej po 3 wnoszących źródłach.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="auto-rescrape"
                checked={autoRescrape}
                onCheckedChange={setAutoRescrape}
              />
              <Label htmlFor="auto-rescrape" className="cursor-pointer text-sm">
                Automatyczne doscrapowanie (rescrape po dopasowaniu)
              </Label>
            </div>
          </div>
        </div>
        <ProjectUsagePanel />
        <div className="pt-4 border-t space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={includeExtra} onCheckedChange={setIncludeExtra} id="extra-imgs" />
            <Label htmlFor="extra-imgs" className="cursor-pointer">
              Uwzględniaj zdjęcia z extraProperties (uwaga: mogą zawierać śmieci)
            </Label>
          </div>
          <div>
            <Label className="text-sm">Mapowanie kolumn Source CSV</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Zostaw puste = automatyczne wykrycie. Podaj dokładną nazwę kolumny z pliku CSV.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Kolumna „id"</Label>
                <Input value={idCol} onChange={(e) => setIdCol(e.target.value)} placeholder="np. product_id" />
              </div>
              <div>
                <Label className="text-xs">Kolumna „nazwa"</Label>
                <Input value={nameCol} onChange={(e) => setNameCol(e.target.value)} placeholder="np. name" />
              </div>
              <div>
                <Label className="text-xs">Kolumna „kod" (kod importu)</Label>
                <Input value={codeCol} onChange={(e) => setCodeCol(e.target.value)} placeholder="np. symbol" />
              </div>
              <div>
                <Label className="text-xs">Kolumna „ean"</Label>
                <Input value={eanCol} onChange={(e) => setEanCol(e.target.value)} placeholder="np. gtin" />
              </div>
            </div>
          </div>
        </div>
        <div className="pt-4 border-t">
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm("Wyczyścić WSZYSTKIE dane projektu (produkty, wyszukiwania, źródła, rekordy)?")) return;
              // We use clearProjectData via the parent through a re-bound action would be cleaner,
              // but keep simple: reload.
              window.location.reload();
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Reset widoku
          </Button>
        </div>
        <div className="pt-4 border-t space-y-3">
          <h3 className="font-semibold text-base">Zdjęcia AI</h3>
          <p className="text-xs text-muted-foreground">
            Ustawienia pipeline'u regeneracji teł (FAL + klasyfikacja Gemini).
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Komponent A (wymagane)</Label>
              <Input value={compA} onChange={(e) => setCompA(e.target.value)} placeholder="np. Pudełko amunicji" maxLength={200} />
            </div>
            <div>
              <Label>Komponent B (opcjonalnie)</Label>
              <Input value={compB} onChange={(e) => setCompB(e.target.value)} placeholder="np. Naboje" maxLength={200} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Reguła miniatury</Label>
              <Select value={rule} onValueChange={(v) => setRule(v as MainImageRule)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ONLY_A">Tylko Komponent A</SelectItem>
                  <SelectItem value="A_AND_B_EXISTING">A + B (jeśli istnieje w jednym kadrze)</SelectItem>
                  <SelectItem value="COMPOSITE_A_AND_B">Kompozycja A + B (FAL łączy)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Limit zdjęć w galerii AI (0-12)</Label>
              <Input type="number" min={0} max={12} value={maxGallery} onChange={(e) => setMaxGallery(Math.max(0, Math.min(12, parseInt(e.target.value) || 0)))} />
            </div>
            <div>
              <Label>Rozdzielczość (px, 512-4096)</Label>
              <Input type="number" min={512} max={4096} step={64} value={resolution} onChange={(e) => setResolution(Math.max(512, Math.min(4096, parseInt(e.target.value) || 2560)))} />
            </div>
            <div>
              <Label>Wypełnienie kadru ({padding}%)</Label>
              <Input type="range" min={30} max={95} value={padding} onChange={(e) => setPadding(parseInt(e.target.value))} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={shadow} onCheckedChange={setShadow} id="ai-shadow" />
            <Label htmlFor="ai-shadow" className="cursor-pointer">Sztuczny cień pod produktem</Label>
          </div>
          <div>
            <Label>Dodatkowy prompt stylistyczny (opcjonalnie)</Label>
            <Textarea value={styleP} onChange={(e) => setStyleP(e.target.value)} rows={3} maxLength={2000} placeholder="np. Studio look, efekt 3D render, delikatny rim light od góry." />
          </div>
          <Button
            onClick={() =>
              onSaveMedia({
                component_a: compA.trim(),
                component_b: compB.trim() || null,
                main_image_rule: rule,
                target_resolution: resolution,
                padding_percent: padding,
                max_gallery_images: maxGallery,
                apply_shadow: shadow,
                custom_style_prompt: styleP.trim() || null,
              })
            }
          >
            Zapisz ustawienia AI
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ProjectUsagePanel() {
  const { id } = Route.useParams();
  const [totals, setTotals] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("bulk_jobs" as never)
        .select("usage, created_at")
        .eq("project_id", id)
        .eq("kind", "FIRECRAWL_DISCOVERY")
        .gte("created_at", since);
      if (cancelled) return;
      const sum: Record<string, number> = {};
      for (const r of (data ?? []) as Array<{ usage?: Record<string, number> | null }>) {
        const u = r.usage ?? {};
        for (const [k, v] of Object.entries(u)) {
          if (typeof v === "number") sum[k] = (sum[k] ?? 0) + v;
        }
      }
      setTotals(sum);
    })();
    return () => { cancelled = true; };
  }, [id]);
  if (!totals) return null;
  const rows: Array<{ k: string; label: string }> = [
    { k: "fc_scrapes", label: "FC scrape" },
    { k: "fc_searches", label: "FC search" },
    { k: "skipped_fc_searches", label: "FC search pominięte" },
    { k: "apify_runs", label: "Apify SERP" },
    { k: "apify_empty", label: "Apify puste" },
    { k: "cache_hits_24h", label: "Cache 24h" },
    { k: "cache_hits_shared", label: "Cache shared 14d" },
  ];
  return (
    <div className="pt-4 border-t space-y-2">
      <Label className="text-sm font-medium">Zużycie (30 dni)</Label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {rows.map((r) => (
          <div key={r.k} className="rounded border px-2 py-1 flex items-center justify-between">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-mono">{totals[r.k] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductThumbs({
  images,
  extraImages,
  pinnedUrl,
  enrichmentId,
  onPin,
  onHide,
}: {
  productId: string;
  images: string[];
  extraImages?: string[];
  pinnedUrl?: string | null;
  enrichmentId?: string | null;
  onPin?: (url: string | null) => void | Promise<void>;
  onHide: (url: string) => void | Promise<void>;
}) {
  const MAX = 8;
  const ordered = pinnedUrl && images.includes(pinnedUrl)
    ? [pinnedUrl, ...images.filter((u) => u !== pinnedUrl)]
    : images;
  const top = ordered.slice(0, MAX);
  const overflow = Math.max(0, ordered.length - top.length);
  const extraSet = new Set(extraImages ?? []);
  const [hovered, setHovered] = useState<{ url: string; x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dimsRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const [, force] = useState(0);
  const ensureDims = (url: string) => {
    if (dimsRef.current.has(url)) return;
    const img = new Image();
    img.onload = () => {
      dimsRef.current.set(url, { w: img.naturalWidth, h: img.naturalHeight });
      force((n) => n + 1);
    };
    img.src = url;
  };
  if (!top.length) {
    return (
      <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center">
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  const dims = hovered ? dimsRef.current.get(hovered.url) : undefined;
  const canPin = !!enrichmentId && !!onPin;
  return (
    <div
      className={`flex flex-wrap gap-1 relative max-w-[260px] rounded p-0.5 transition-colors ${dragOver ? "bg-primary/10 ring-2 ring-primary" : ""}`}
      onDragOver={(e) => {
        if (!canPin) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (!canPin) return;
        const url = e.dataTransfer.getData("text/plain");
        if (!url || !top.includes(url)) return;
        e.preventDefault();
        void onPin!(url);
      }}
    >
      {top.map((url) => (
        <div key={url} className="relative group">
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="block"
                draggable={canPin}
                onDragStart={(e) => {
                  if (!canPin) return;
                  e.dataTransfer.setData("text/plain", url);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  ensureDims(url);
                  const PREVIEW_W = 320;
                  const PREVIEW_H = 360;
                  const GAP = 4;
                  const vw = window.innerWidth;
                  const vh = window.innerHeight;
                  let x = r.right + GAP;
                  if (x + PREVIEW_W + 8 > vw) {
                    x = r.left - PREVIEW_W - GAP;
                  }
                  x = Math.max(8, Math.min(x, vw - PREVIEW_W - 8));
                  let y = r.top;
                  if (y + PREVIEW_H + 8 > vh) {
                    y = vh - PREVIEW_H - 8;
                  }
                  y = Math.max(8, y);
                  setHovered({ url, x, y });
                }}
                onMouseLeave={() => setHovered((h) => (h?.url === url ? null : h))}
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className={`h-10 w-10 object-cover rounded border hover:opacity-80 ${pinnedUrl === url ? "ring-2 ring-primary" : extraSet.has(url) ? "ring-2 ring-amber-400" : ""}`}
                />
                {pinnedUrl === url && (
                  <span className="absolute -top-1 -left-1 bg-primary text-primary-foreground text-[8px] font-bold px-1 rounded leading-tight">
                    główne
                  </span>
                )}
                {extraSet.has(url) && (
                  <span className="absolute -bottom-1 -left-1 bg-amber-400 text-[8px] font-bold text-black px-1 rounded leading-tight">
                    extra
                  </span>
                )}
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <img src={url} alt="" className="w-full h-auto rounded" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground break-all"
              >
                {url}
              </a>
            </DialogContent>
          </Dialog>
          {canPin && (
            <button
              type="button"
              title={pinnedUrl === url ? "Odepnij główne" : "Ustaw jako główne"}
              onClick={(e) => {
                e.stopPropagation();
                void onPin!(pinnedUrl === url ? null : url);
              }}
              className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 ${pinnedUrl === url ? "bg-primary text-primary-foreground opacity-100" : "bg-background border"}`}
            >
              {pinnedUrl === url ? <PinOff className="h-2.5 w-2.5" /> : <Pin className="h-2.5 w-2.5" />}
            </button>
          )}
          <button
            type="button"
            title="Ukryj zdjęcie"
            onClick={(e) => {
              e.stopPropagation();
              void onHide(url);
            }}
            className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 flex items-center justify-center"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
      ))}
      {overflow > 0 && (
        <div className="h-10 min-w-10 px-1 rounded border bg-muted flex items-center justify-center text-xs text-muted-foreground font-medium">
          +{overflow}
        </div>
      )}
      {hovered && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-50 pointer-events-none rounded-lg border bg-background shadow-xl overflow-hidden"
              style={{ left: hovered.x, top: hovered.y }}
            >
              <div className="px-2 py-1 bg-foreground text-background text-xs font-mono text-center">
                {dims ? `${dims.w} × ${dims.h} px` : "ładuję…"}
              </div>
              <img
                src={hovered.url}
                alt=""
                className="block"
                style={{ maxWidth: 320, maxHeight: 320 }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}