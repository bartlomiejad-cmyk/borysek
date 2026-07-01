import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getPhotoProject,
  addPhotoProduct,
  deletePhotoProduct,
  updatePhotoProject,
  editPhotoImage,
  type PhotoProduct,
} from "@/lib/photo-tool/photo-tool.functions";
import {
  createBulkJob,
  cancelBulkJob,
  getActiveBulkJob,
} from "@/lib/pim/bulk-jobs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Pencil, Plus, Sparkles, StopCircle, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BulkJobLog } from "@/components/pim/BulkJobLog";

export const Route = createFileRoute("/_auth/photo/$id")({ component: PhotoProjectPage });

function StatusBadge({ status }: { status: PhotoProduct["status"] }) {
  const map: Record<PhotoProduct["status"], { label: string; cls: string }> = {
    PENDING: { label: "Oczekuje", cls: "bg-muted text-muted-foreground" },
    PROCESSING: { label: "Generuję…", cls: "bg-primary/15 text-primary" },
    DONE: { label: "Gotowe", cls: "bg-emerald-500/15 text-emerald-500" },
    FAILED: { label: "Błąd", cls: "bg-destructive/15 text-destructive" },
  };
  const s = map[status];
  return <span className={`text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 ${s.cls}`}>{s.label}</span>;
}

function PhotoProjectPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getPhotoProject);
  const addFn = useServerFn(addPhotoProduct);
  const delFn = useServerFn(deletePhotoProduct);
  const updFn = useServerFn(updatePhotoProject);
  const editFn = useServerFn(editPhotoImage);
  const createJob = useServerFn(createBulkJob);
  const cancelJob = useServerFn(cancelBulkJob);
  const activeJob = useServerFn(getActiveBulkJob);

  const { data, isLoading } = useQuery({
    queryKey: ["photo-project", id],
    queryFn: () => getFn({ data: { id } }),
    // Poll while a generation job is in flight — realtime for photo_products
    // is not always available; this guarantees the grid refreshes.
    refetchInterval: (q) => {
      const j = qc.getQueryData<any>(["photo-project-job", id]);
      const active = j && (j.status === "PENDING" || j.status === "PROCESSING");
      return active ? 2000 : false;
    },
  });

  const { data: job } = useQuery({
    queryKey: ["photo-project-job", id],
    queryFn: () => activeJob({ data: { projectId: id, kind: "PHOTO_TOOL_GENERATE" } }),
    refetchInterval: 2000,
  });

  // Realtime — refresh product statuses as the worker writes them.
  useEffect(() => {
    const channel = supabase
      .channel(`photo-products-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photo_products", filter: `project_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["photo-project", id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, qc]);

  // Add-product form state
  const [urlInput, setUrlInput] = useState("");
  const [pending, setPending] = useState<
    { key: string; name: string; localUrl: string; status: "uploading" | "done" | "error"; publicUrl?: string; error?: string }[]
  >([]);
  const [pName, setPName] = useState("");
  const [pDesc, setPDesc] = useState("");

  const readyUrls = pending.filter((f) => f.status === "done" && f.publicUrl).map((f) => f.publicUrl as string);
  const totalSources = readyUrls.length + (urlInput.trim() ? 1 : 0);

  async function uploadFiles(files: File[]) {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) { toast.error("Zaloguj się ponownie"); return; }
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
        toast.error(`${file.name}: dozwolone JPG/PNG/WebP`);
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        toast.error(`${file.name}: max 20 MB`);
        continue;
      }
      const localUrl = URL.createObjectURL(file);
      setPending((prev) => [...prev, { key, name: file.name, localUrl, status: "uploading" }]);
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `photo-tool-sources/${uid}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("regenerated-images")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        setPending((prev) => prev.map((p) => (p.key === key ? { ...p, status: "error", error: error.message } : p)));
        toast.error(`${file.name}: ${error.message}`);
        continue;
      }
      const { data: pub } = supabase.storage.from("regenerated-images").getPublicUrl(path);
      setPending((prev) => prev.map((p) => (p.key === key ? { ...p, status: "done", publicUrl: pub.publicUrl } : p)));
    }
  }

  function removePending(key: string) {
    setPending((prev) => {
      const item = prev.find((p) => p.key === key);
      if (item?.localUrl) URL.revokeObjectURL(item.localUrl);
      return prev.filter((p) => p.key !== key);
    });
  }

  const add = useMutation({
    mutationFn: async () => {
      const urls = [...readyUrls];
      if (urlInput.trim()) urls.push(urlInput.trim());
      if (!urls.length) throw new Error("Dodaj przynajmniej jedno zdjęcie źródłowe (upload lub URL)");
      if (pending.some((p) => p.status === "uploading")) throw new Error("Poczekaj aż uploady się zakończą");
      await addFn({
        data: {
          projectId: id,
          source_image_urls: urls,
          name: pName.trim() || null,
          description: pDesc.trim() || null,
        },
      });
    },
    onSuccess: () => {
      for (const p of pending) if (p.localUrl) URL.revokeObjectURL(p.localUrl);
      setPending([]); setUrlInput(""); setPName(""); setPDesc("");
      qc.invalidateQueries({ queryKey: ["photo-project", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const del = useMutation({
    mutationFn: (pid: string) => delFn({ data: { id: pid } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo-project", id] }),
  });

  const [style, setStyle] = useState<string | null>(null);
  const [reqPl, setReqPl] = useState<string | null>(null);
  useEffect(() => {
    if (data?.project) {
      if (style === null) setStyle(data.project.style_prompt ?? "");
      if (reqPl === null) setReqPl((data.project as any).requirements_pl ?? "");
    }
  }, [data?.project]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSettings = useMutation({
    mutationFn: () =>
      updFn({
        data: {
          id,
          style_prompt: (style ?? "").trim() || null,
          requirements_pl: (reqPl ?? "").trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Ustawienia zapisane");
      qc.invalidateQueries({ queryKey: ["photo-project", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  // --- Per-image edit state ---------------------------------------------------
  // busyEdits tracks slot keys currently being processed by FAL. We remember
  // the URL that was showing when the user submitted so we know when it has
  // been replaced and can lift the "editing…" overlay.
  type EditKey = string; // `${productId}:${slot}:${index}`
  const editKey = (productId: string, slot: "thumbnail" | "lifestyle", i: number) =>
    `${productId}:${slot}:${i}`;
  const [busyEdits, setBusyEdits] = useState<Record<EditKey, string /* url snapshot */>>({});
  const [editDialog, setEditDialog] = useState<null | {
    productId: string;
    slot: "thumbnail" | "lifestyle";
    lifestyleIndex: number;
    currentUrl: string;
    productName: string;
  }>(null);
  const [editText, setEditText] = useState("");

  // When product data refreshes, clear busy overlays whose target url changed.
  useEffect(() => {
    if (!data?.products) return;
    setBusyEdits((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [k, snapshot] of Object.entries(prev)) {
        const [productId, slot, idxStr] = k.split(":");
        const prod = data.products.find((pp) => pp.id === productId);
        if (!prod) continue;
        const cur =
          slot === "thumbnail"
            ? prod.thumbnail_url
            : prod.lifestyle_urls[Number(idxStr)];
        if (cur && cur !== snapshot) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data?.products]);

  // Poll while any edit is in flight so realtime hiccups don't strand the UI.
  useEffect(() => {
    if (Object.keys(busyEdits).length === 0) return;
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["photo-project", id] });
    }, 2500);
    return () => clearInterval(t);
  }, [busyEdits, id, qc]);

  const submitEdit = useMutation({
    mutationFn: async () => {
      if (!editDialog) throw new Error("brak kontekstu");
      const txt = editText.trim();
      if (txt.length < 2) throw new Error("Opisz co poprawić (min. 2 znaki)");
      const key = editKey(editDialog.productId, editDialog.slot, editDialog.lifestyleIndex);
      setBusyEdits((prev) => ({ ...prev, [key]: editDialog.currentUrl }));
      try {
        await editFn({
          data: {
            photoProductId: editDialog.productId,
            slot: editDialog.slot,
            lifestyleIndex: editDialog.lifestyleIndex,
            requirementsPl: txt,
          },
        });
      } catch (e) {
        setBusyEdits((prev) => {
          const n = { ...prev };
          delete n[key];
          return n;
        });
        throw e;
      }
    },
    onSuccess: () => {
      toast.success("Poprawka wysłana. Wygenerowana wersja pojawi się za chwilę.");
      setEditDialog(null);
      setEditText("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  function openEdit(
    productId: string,
    productName: string,
    slot: "thumbnail" | "lifestyle",
    lifestyleIndex: number,
    currentUrl: string,
  ) {
    setEditText("");
    setEditDialog({ productId, productName, slot, lifestyleIndex, currentUrl });
  }

  const generateAll = useMutation({
    mutationFn: async () => {
      const items = (data?.products ?? [])
        .filter((p) => p.status !== "PROCESSING")
        .map((p) => p.id);
      if (!items.length) throw new Error("Brak produktów do wygenerowania");
      await createJob({ data: { projectId: id, kind: "PHOTO_TOOL_GENERATE", items } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo-project-job", id] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd"),
  });

  const stop = useMutation({
    mutationFn: async () => {
      if (!job) return;
      await cancelJob({ data: { jobId: job.id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo-project-job", id] }),
  });

  if (isLoading || !data) {
    return (
      <div className="container mx-auto max-w-5xl px-6 py-16 text-muted-foreground">
        Ładowanie…
      </div>
    );
  }

  const products = data.products;
  const active = job && (job.status === "PENDING" || job.status === "PROCESSING");
  const total = job?.total ?? 0;
  const processed = (job?.processed_count ?? 0) + (job?.failed_count ?? 0);
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="container mx-auto max-w-6xl px-6 pt-8 pb-16">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate({ to: "/photo" })}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Wszystkie projekty
      </Button>

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-6">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">{data.project.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {products.length} produkt(ów) · nano-banana-pro · 2K packshot + wizualizacje
          </p>
        </div>
        <div className="flex gap-2">
          {active ? (
            <Button variant="outline" onClick={() => stop.mutate()} disabled={stop.isPending}>
              <StopCircle className="h-4 w-4 mr-2" />
              Zatrzymaj
            </Button>
          ) : (
            <Button onClick={() => generateAll.mutate()} disabled={!products.length || generateAll.isPending}>
              {generateAll.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Generuj wszystkie
            </Button>
          )}
        </div>
      </div>

      {/* Job progress + live log */}
      {job && (job.status === "PENDING" || job.status === "PROCESSING" || (job.finished_at && Date.now() - new Date(job.finished_at).getTime() < 30_000)) && (
        <div className="rounded-2xl border border-border/50 bg-card/60 p-4 mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">
              {active ? "Generowanie w toku…" : `Zakończono: ${job.status}`}
            </span>
            <span className="text-muted-foreground">
              {processed}/{total} ({pct}%)
            </span>
          </div>
          <Progress value={pct} />
          <BulkJobLog jobId={job.id} />
        </div>
      )}

      {/* Settings */}
      <div className="rounded-2xl border border-border/50 bg-card/60 p-4 mb-6 grid md:grid-cols-3 gap-4">
        <div className="md:col-span-3">
          <Label className="text-xs">Styl / scena dla wizualizacji (opcjonalnie)</Label>
          <Textarea
            rows={2}
            placeholder="np. Nowoczesna kuchnia, blat drewniany, poranne światło z okna, minimalizm."
            value={style ?? ""}
            onChange={(e) => setStyle(e.target.value)}
          />
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Wymagania (PL) — AI przepisze je na profesjonalny prompt EN dla generatora</Label>
          <Textarea
            rows={4}
            placeholder={"np. Miniaturka: produkt na białym tle z 2–3 świeżymi listkami po lewej stronie i drobnymi ścinkami trawy. Wizualizacja: ogród, poranne światło, dłoń w rękawicy trzymająca produkt, w tle rozmyty żywopłot."}
            value={reqPl ?? ""}
            onChange={(e) => setReqPl(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Piszesz po polsku co ma być na miniaturce i wizualizacji. Gemini 3.1 Pro tłumaczy to na precyzyjny prompt EN, dbając równocześnie, żeby produkt pozostał wierny oryginałowi.
          </p>
        </div>
        <div className="md:col-span-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
            Zapisz ustawienia
          </Button>
        </div>
      </div>

      {/* Add product */}
      <div className="rounded-2xl border border-border/50 bg-card/60 p-4 mb-8">
        <h2 className="font-serif text-xl mb-3">Dodaj produkt</h2>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Zdjęcia źródłowe *</Label>
            <label
              className="mt-1 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/60 p-6 cursor-pointer hover:bg-muted/40 transition"
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) void uploadFiles(files);
              }}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm">Przeciągnij zdjęcia lub kliknij, żeby wybrać</div>
              <div className="text-[11px] text-muted-foreground">
                JPG / PNG / WebP · do 20 MB każde · bez limitu ilości
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length) void uploadFiles(files);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {pending.length > 0 && (
              <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {pending.map((f) => (
                  <div key={f.key} className="relative group">
                    <img src={f.localUrl} alt="" className="w-full aspect-square object-cover rounded-md border" />
                    {f.status === "uploading" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70 rounded-md">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      </div>
                    )}
                    {f.status === "error" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-destructive/70 text-white text-[10px] p-1 rounded-md text-center">
                        {f.error?.slice(0, 40)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePending(f.key)}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-background border shadow p-0.5 opacity-0 group-hover:opacity-100 transition"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">…lub wklej URL zdjęcia (opcjonalnie, dodatkowe źródło)</Label>
            <Input
              placeholder="https://…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nazwa produktu</Label>
              <Input
                placeholder="np. Kubek ceramiczny 300 ml"
                value={pName}
                onChange={(e) => setPName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Opis produktu (kluczowe cechy)</Label>
              <Textarea
                rows={2}
                placeholder="Cechy, materiał, kolor, przeznaczenie… używane do wiernego odwzorowania."
                value={pDesc}
                onChange={(e) => setPDesc(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {totalSources > 0 ? (
                <>
                  {totalSources} {totalSources === 1 ? "zdjęcie" : "zdjęć"} źródłowych →{" "}
                  <b>1 miniaturka + 5 wizualizacji</b>
                </>
              ) : (
                <>Dodaj zdjęcia — z każdego produktu powstaje <b>1 miniaturka + 5 wizualizacji</b>.</>
              )}
            </div>
            <Button onClick={() => add.mutate()} disabled={add.isPending || totalSources === 0 || pending.some((p) => p.status === "uploading")}>
              {add.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Dodaj do projektu
            </Button>
          </div>
        </div>
      </div>

      {/* Products grid */}
      {products.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/60 p-12 text-center text-muted-foreground">
          Brak produktów. Dodaj pierwszy powyżej.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {products.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border/50 bg-card/60 p-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name || "(bez nazwy)"}</div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={p.status} />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => { if (confirm("Usunąć produkt?")) del.mutate(p.id); }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mb-3">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">
                  Źródła ({(p.source_image_urls?.length || 1)})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(p.source_image_urls?.length ? p.source_image_urls : [p.source_image_url]).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="block w-14">
                      <img
                        src={u}
                        alt=""
                        className="w-14 h-14 object-cover rounded-md border"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">Miniaturka</div>
                  {p.thumbnail_url ? (
                    <a href={p.thumbnail_url} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={p.thumbnail_url}
                        alt=""
                        className="w-full aspect-square object-cover rounded-md border bg-white"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <div className="w-full aspect-square rounded-md border border-dashed" />
                  )}
                </div>
                {Array.from({ length: 2 }).map((_, i) => {
                  const u = p.lifestyle_urls[i];
                  return (
                    <div key={i}>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Wiz. {i + 1}</div>
                      {u ? (
                        <a href={u} target="_blank" rel="noreferrer" className="block">
                          <img src={u} alt="" className="w-full aspect-square object-cover rounded-md border" loading="lazy" />
                        </a>
                      ) : (
                        <div className="w-full aspect-square rounded-md border border-dashed" />
                      )}
                    </div>
                  );
                })}
              </div>

              {p.lifestyle_urls.length > 2 && (
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {p.lifestyle_urls.slice(2).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="block">
                      <img src={u} alt="" className="w-full aspect-square object-cover rounded-md border" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}

              {p.status === "FAILED" && p.last_error && (
                <div className="mt-3 text-xs text-destructive">
                  {p.last_error}
                </div>
              )}

              {(p.generated_thumb_prompt || p.generated_lifestyle_prompt) && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Prompty EN użyte do generacji
                  </summary>
                  <div className="mt-2 space-y-2">
                    {p.generated_thumb_prompt && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Miniaturka</div>
                        <div className="p-2 rounded bg-muted/40 whitespace-pre-wrap break-words">
                          {p.generated_thumb_prompt}
                        </div>
                      </div>
                    )}
                    {p.generated_lifestyle_prompt && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Wizualizacja</div>
                        <div className="p-2 rounded bg-muted/40 whitespace-pre-wrap break-words">
                          {p.generated_lifestyle_prompt}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 text-xs text-muted-foreground">
        <Link to="/photo" className="underline underline-offset-4">← Powrót do listy projektów zdjęciowych</Link>
        <span className="mx-2">·</span>
        Model: <Badge variant="outline" className="text-[10px]">fal-ai/nano-banana-pro/edit</Badge>
        <span className="mx-1" />
        rozdzielczość 2K (~2048×2048).
      </div>
    </div>
  );
}