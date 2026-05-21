import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { toast } from "sonner";
import { getProject, updateProject } from "@/lib/pim/projects.functions";
import {
  ingestSourceProducts,
  ingestSearchResults,
  ingestProductSources,
  clearProjectData,
} from "@/lib/pim/ingest.functions";
import { runMatching } from "@/lib/pim/matching.functions";
import { listProductsWithEnrichment } from "@/lib/pim/queries.functions";
import { generateGoldenRecord, verifySources } from "@/lib/pim/ai.functions";
import { exportProject } from "@/lib/pim/export.functions";
import { parseCsv, parseSearchJson, parseProductJson } from "@/lib/pim/parsers";
import { hideImageByProduct } from "@/lib/pim/enrichments.functions";
import { setPinnedMainImage } from "@/lib/pim/enrichments.functions";
import { regenerateMainImage } from "@/lib/pim/regen.functions";
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
import { UploadZone } from "@/components/pim/UploadZone";
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
} from "lucide-react";

export const Route = createFileRoute("/_auth/projects/$id/")({ component: ProjectPage });

const CONCURRENCY = 5;

function ProjectPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const getFn = useServerFn(getProject);
  const updFn = useServerFn(updateProject);
  const ingSpFn = useServerFn(ingestSourceProducts);
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

  const { data: meta } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getFn({ data: { id } }),
  });
  const { data: products = [], refetch: refetchProducts } = useQuery({
    queryKey: ["project", id, "products"],
    queryFn: () => listFn({ data: { projectId: id } }),
  });

  const [filter, setFilter] = useState<"ALL" | "MATCHED" | "PENDING" | "GENERATED" | "NO_MATCH">("ALL");
  const [search, setSearch] = useState("");
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [regenProgress, setRegenProgress] = useState<{ done: number; total: number } | null>(null);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === "MATCHED" && p.match_type === "NO_MATCH") return false;
      if (filter === "PENDING" && p.status !== "PENDING") return false;
      if (filter === "GENERATED" && p.status !== "GENERATED") return false;
      if (filter === "NO_MATCH" && p.match_type !== "NO_MATCH") return false;
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
    setPage(1);
  }, [filter, search, pageSize]);

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

  const handleSourceCsv = async (file: File) => {
    const rows = await parseCsv(file, {
      id_column: meta?.project.id_column,
      name_column: meta?.project.name_column,
      code_column: meta?.project.code_column,
      ean_column: meta?.project.ean_column,
    });
    if (!rows.length) throw new Error("Pusty plik CSV lub brak nagłówków id/nazwa/kod/ean");
    await clearFn({ data: { projectId: id, scope: "source_products" } });
    const batchSize = 1000;
    for (let i = 0; i < rows.length; i += batchSize) {
      await ingSpFn({ data: { projectId: id, rows: rows.slice(i, i + batchSize) } });
    }
    toast.success(`Wczytano ${rows.length} produktów`);
    qc.invalidateQueries({ queryKey: ["project", id] });
    refetchProducts();
  };

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
    setGenProgress({ done: 0, total: targets.length });
    let done = 0;
    let failed = 0;
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        if (!p) break;
        try {
          // 1) Verify sources (watermark/mismatch detection + measure image sizes).
          //    Best-effort: a failure here MUST NOT block generation.
          try {
            await verifyFn({ data: { productId: p.id } });
          } catch (e) {
            console.warn("verifySources failed for", p.id, e);
          }
          // 2) Generate golden record (name + description + features).
          await genFn({ data: { productId: p.id, mode: "all" } });
        } catch {
          failed++;
        }
        done++;
        setGenProgress({ done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setGenProgress(null);
    toast.success(`Wygenerowano ${done - failed}/${targets.length}${failed ? `, ${failed} błędów` : ""}`);
    refetchProducts();
  };

  const regenerateAll = async (productIds?: string[]) => {
    const idSet = productIds ? new Set(productIds) : null;
    const source = idSet ? products.filter((p) => idSet.has(p.id)) : filtered;
    const targets = source
      .map((p) => ({
        enrichmentId: (p as { enrichment_id?: string | null }).enrichment_id ?? null,
        url:
          (p as { pinned_main_url?: string | null }).pinned_main_url ??
          ((p.images ?? [])[0] ?? null),
      }))
      .filter((t): t is { enrichmentId: string; url: string } => !!t.enrichmentId && !!t.url);
    if (!targets.length) {
      toast.info("Brak produktów do regeneracji");
      return;
    }
    if (!confirm(`Zregenerować tła dla ${targets.length} produktów? To zużyje kredyty FAL.`)) return;
    setRegenProgress({ done: 0, total: targets.length });
    let done = 0;
    let failed = 0;
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        if (!t) break;
        try {
          await regenFn({ data: { enrichmentId: t.enrichmentId, imageUrl: t.url } });
        } catch (e) {
          console.warn("regen failed", t, e);
          failed++;
        }
        done++;
        setRegenProgress({ done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRegenProgress(null);
    toast.success(`Zregenerowano ${done - failed}/${targets.length}${failed ? `, ${failed} błędów` : ""}`);
    refetchProducts();
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => matchMut.mutate()} disabled={matchMut.isPending}>
            <Play className="h-4 w-4 mr-2" /> Dopasuj
          </Button>
          <Button onClick={() => generateAll()} disabled={!!genProgress}>
            <Sparkles className="h-4 w-4 mr-2" /> Generuj złote rekordy
          </Button>
          <Button variant="outline" onClick={() => regenerateAll()} disabled={!!regenProgress}>
            <RefreshCw className="h-4 w-4 mr-2" /> Regeneruj tła
          </Button>
          <Button asChild variant="outline">
            <Link to="/projects/$id/verify" params={{ id }}>
              <ShieldCheck className="h-4 w-4 mr-2" /> Widok weryfikacyjny
            </Link>
          </Button>
          <Button variant="outline" onClick={() => exportFile("csv")}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
          <Button variant="outline" onClick={() => exportFile("xlsx")}>
            <Download className="h-4 w-4 mr-2" /> XLSX
          </Button>
        </div>
      </div>

      {genProgress && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>Weryfikacja i generacja {genProgress.done}/{genProgress.total}</span>
              <span className="text-muted-foreground">{Math.round((genProgress.done / genProgress.total) * 100)}%</span>
            </div>
            <Progress value={(genProgress.done / genProgress.total) * 100} />
          </CardContent>
        </Card>
      )}

      {regenProgress && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>Regeneracja teł {regenProgress.done}/{regenProgress.total}</span>
              <span className="text-muted-foreground">{Math.round((regenProgress.done / regenProgress.total) * 100)}%</span>
            </div>
            <Progress value={(regenProgress.done / regenProgress.total) * 100} />
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="data" className="mb-4">
        <TabsList>
          <TabsTrigger value="data">Dane</TabsTrigger>
          <TabsTrigger value="settings">Ustawienia</TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="space-y-3 pt-3">
          <div className="grid md:grid-cols-3 gap-3">
            <UploadZone
              title="Source CSV"
              accept=".csv,text/csv"
              description="Twoja baza: id, nazwa, kod, ean"
              count={meta?.counts.source_products}
              onFile={handleSourceCsv}
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
        </TabsContent>

        <TabsContent value="settings" className="pt-3">
          <SettingsCard
            project={meta?.project}
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
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Wszystkie</SelectItem>
                <SelectItem value="MATCHED">Dopasowane</SelectItem>
                <SelectItem value="NO_MATCH">Bez dopasowania</SelectItem>
                <SelectItem value="PENDING">Bez złotego rekordu</SelectItem>
                <SelectItem value="GENERATED">Z złotym rekordem</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
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
                disabled={!!genProgress}
              >
                <Sparkles className="h-4 w-4 mr-1" /> Generuj złote rekordy
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => regenerateAll([...selectedIds])}
                disabled={!!regenProgress}
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Regeneruj tła
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportFile("csv")}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportFile("xlsx")}>
                <Download className="h-4 w-4 mr-1" /> XLSX
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
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
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
                    </TableCell>
                    <TableCell>
                      <div className="font-medium line-clamp-1">{p.golden_name ?? p.nazwa ?? "—"}</div>
                      {p.golden_name && p.nazwa && (
                        <div className="text-xs text-muted-foreground line-clamp-1">{p.nazwa}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{p.ean ?? "—"}</div>
                      <div className="text-muted-foreground">{p.kod ?? ""}</div>
                    </TableCell>
                    <TableCell>
                      <MatchBadge type={p.match_type as string} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status as string} error={p.error} />
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
                          <Link to="/projects/$id/products/$pid" params={{ id, pid: p.id }}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
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
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
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
  }) => Promise<void>;
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
      {hovered ? (
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
        </div>
      ) : null}
    </div>
  );
}