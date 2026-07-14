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
} from "@/lib/pim/ingest.functions";
import { runMatching } from "@/lib/pim/matching.functions";
import { listProductsWithEnrichment, getPipelineSummary } from "@/lib/pim/queries.functions";
import { generateGoldenRecord, verifySources } from "@/lib/pim/ai.functions";
import { exportProject } from "@/lib/pim/export.functions";
import { parseSearchJson, parseProductJson } from "@/lib/pim/parsers";
import { hideImageByProduct } from "@/lib/pim/enrichments.functions";
import { setPinnedMainImage } from "@/lib/pim/enrichments.functions";
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
import { startFirecrawlDiscovery, recleanProductSources } from "@/lib/pim/firecrawl.functions";
import { deleteProducts } from "@/lib/pim/products.functions";
import { BulkJobLog } from "@/components/pim/BulkJobLog";
import { FillMissingImagesDialog, type FillTarget } from "@/components/pim/FillMissingImagesDialog";
import { GenerateVisualizationsDialog, type VizTarget } from "@/components/pim/GenerateVisualizationsDialog";
import { ShareProjectDialog } from "@/components/pim/ShareProjectDialog";
import { ClientGuidelinesDialog } from "@/components/pim/ClientGuidelinesDialog";
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
} from "lucide-react";
import {
  PIPELINE_STATUS_LABEL,
  type PimPipelineStatus,
} from "@/lib/pim/pipeline-status";
import { setManualLock } from "@/lib/pim/enrichments.functions";

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
    ])
    .catch("ALL"),
  search: z.string().catch(""),
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
  const setLockFn = useServerFn(setManualLock);
  const deleteProductsFn = useServerFn(deleteProducts);
  const summaryFn = useServerFn(getPipelineSummary);

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
  const genActive = genJob && (genJob.status === "PENDING" || genJob.status === "PROCESSING");
  const regenActive = regenJob && (regenJob.status === "PENDING" || regenJob.status === "PROCESSING");
  const discActive = discJob && (discJob.status === "PENDING" || discJob.status === "PROCESSING");
  const vizActive = vizJob && (vizJob.status === "PENDING" || vizJob.status === "PROCESSING");
  const allegroActive = allegroJob && (allegroJob.status === "PENDING" || allegroJob.status === "PROCESSING");
  const verifyActive = verifyJob && (verifyJob.status === "PENDING" || verifyJob.status === "PROCESSING");

  // Show toast once per terminal job state + refetch products.
  useEffect(() => {
    for (const job of [genJob, regenJob, discJob, vizJob, allegroJob, verifyJob]) {
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
  }, [genJob, regenJob, discJob, vizJob, allegroJob, verifyJob, refetchProducts]);

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
      return true;
    });
  }, [products, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  // Reset page when filter/search/pageSize changes
  useEffect(() => {
    if (page !== 1) updateSearch({ page: 1 });
  }, [filter, search, pageSize]);

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
        setVerifyOpen(true);
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
    const targets = products.filter((p) => {
      if (idSet && !idSet.has(p.id)) return false;
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
    const targets = source.filter((p) => !!(p as { enrichment_id?: string | null }).enrichment_id);
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
      (p) => !!(p as { enrichment_id?: string | null }).enrichment_id,
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

  const exportFile = async (fmt: "csv" | "xlsx") => {
    const allRows = await exportFn({ data: { projectId: id } });
    const rows =
      selectedIds.size > 0
        ? allRows.filter((r: Record<string, unknown>) => {
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
            {meta?.counts.source_products ?? 0} produktów · {meta?.counts.search_results ?? 0} zapytań ·{" "}
            {meta?.counts.product_sources ?? 0} stron źródłowych · {meta?.counts.enrichments_done ?? 0} złotych rekordów
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
                <Sparkles className="h-4 w-4 mr-2" /> Wyczyść źródła
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
              <DropdownMenuItem onSelect={() => exportFile("csv")}>
                <Download className="h-4 w-4 mr-2" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportFile("xlsx")}>
                <Download className="h-4 w-4 mr-2" /> XLSX
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
          activeStage={stage}
          onStageClick={handleStageClick}
          onPrimaryAction={handleStagePrimary}
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
                <SelectItem value="MATCHED">Dopasowane</SelectItem>
                <SelectItem value="NO_MATCH">Bez dopasowania</SelectItem>
                <SelectItem value="PENDING">Bez złotego rekordu</SelectItem>
                <SelectItem value="GENERATED">Z złotym rekordem</SelectItem>
                <SelectItem value="NO_IMAGES">Bez zdjęć</SelectItem>
                <SelectItem value="POOR_DATA">Ubogie dane (partial/poor)</SelectItem>
                <SelectItem value="LOCKED">🔒 Zablokowane (manual)</SelectItem>
                <SelectItem value="REVIEW">Kolejka review</SelectItem>
                <SelectItem value="PIPE_IMPORTED">Etap: Zaimportowany</SelectItem>
                <SelectItem value="PIPE_SOURCES_FOUND">Etap: Źródła znalezione</SelectItem>
                <SelectItem value="PIPE_MATCHED">Etap: Dopasowany</SelectItem>
                <SelectItem value="PIPE_GOLDEN_READY">Etap: Rekord gotowy</SelectItem>
                <SelectItem value="PIPE_VISUALS_READY">Etap: Wizualizacje gotowe</SelectItem>
              </SelectContent>
            </Select>
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
              <Button size="sm" variant="outline" onClick={() => exportFile("csv")}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportFile("xlsx")}>
                <Download className="h-4 w-4 mr-1" /> XLSX
              </Button>
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
                      Brak produktów do wyświetlenia
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
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                          title="Etap procesu"
                        >
                          {PIPELINE_STATUS_LABEL[
                            (((p as { pipeline_status?: string | null }).pipeline_status ?? "IMPORTED") as PimPipelineStatus)
                          ] ?? "Zaimportowany"}
                        </Badge>
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
                      </div>
                      {(() => {
                        const g = ((p as { ai_gallery_urls?: string[] }).ai_gallery_urls ?? []) as string[];
                        if (!g.length) return null;
                        return (
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-700 border-violet-400/50 dark:text-violet-300">
                            <Wand2 className="h-2.5 w-2.5" /> Wizualizacje AI · {g.length}
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
                          title="Regeneruj tło"
                          disabled={
                            !((p as { enrichment_id?: string | null }).enrichment_id) ||
                            !(((p as { pinned_main_url?: string | null }).pinned_main_url) || (p.images ?? [])[0])
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
        allProducts={products.map<VizTarget>((p) => ({
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
      />
      <ShareProjectDialog open={shareOpen} onOpenChange={setShareOpen} projectId={id} />
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
              },
            })
          }
        >
          Zapisz
        </Button>
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