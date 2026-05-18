import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
import { generateGoldenRecord } from "@/lib/pim/ai.functions";
import { exportProject } from "@/lib/pim/export.functions";
import { parseCsv, parseSearchJson, parseProductJson } from "@/lib/pim/parsers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  const exportFn = useServerFn(exportProject);

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
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);

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

  // ---- Uploads ----

  const handleSourceCsv = async (file: File) => {
    const rows = await parseCsv(file);
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

  const generateAll = async () => {
    const targets = products.filter((p) => p.match_type !== "NO_MATCH" && p.status !== "GENERATED");
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

  const exportFile = async (fmt: "csv" | "xlsx") => {
    const rows = await exportFn({ data: { projectId: id } });
    if (fmt === "csv") {
      const csv = Papa.unparse(rows);
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
          <h1 className="text-3xl font-bold tracking-tight">{meta?.project.name ?? "..."}</h1>
          <p className="text-sm text-muted-foreground">
            {meta?.counts.source_products ?? 0} produktów · {meta?.counts.search_results ?? 0} zapytań ·{" "}
            {meta?.counts.product_sources ?? 0} stron źródłowych · {meta?.counts.enrichments_done ?? 0} złotych rekordów
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => matchMut.mutate()} disabled={matchMut.isPending}>
            <Play className="h-4 w-4 mr-2" /> Dopasuj
          </Button>
          <Button onClick={generateAll} disabled={!!genProgress}>
            <Sparkles className="h-4 w-4 mr-2" /> Generuj złote rekordy
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
              <span>Generowanie {genProgress.done}/{genProgress.total}</span>
              <span className="text-muted-foreground">{Math.round((genProgress.done / genProgress.total) * 100)}%</span>
            </div>
            <Progress value={(genProgress.done / genProgress.total) * 100} />
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
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14"></TableHead>
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
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      Brak produktów do wyświetlenia
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" className="h-10 w-10 object-cover rounded border" />
                      ) : (
                        <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center">
                          <ImageOff className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
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
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/projects/$id/products/$pid" params={{ id, pid: p.id }}>
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
  };
  onSave: (p: {
    name?: string;
    custom_prompt?: string;
    blacklist?: string[];
    strategy?: "EAN" | "NAZWA" | "HYBRID";
  }) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [prompt, setPrompt] = useState(project?.custom_prompt ?? "");
  const [blacklist, setBlacklist] = useState((project?.blacklist ?? []).join("\n"));
  const [strategy, setStrategy] = useState<"EAN" | "NAZWA" | "HYBRID">(
    (project?.strategy as "EAN" | "NAZWA" | "HYBRID") ?? "HYBRID",
  );

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
            })
          }
        >
          Zapisz
        </Button>
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