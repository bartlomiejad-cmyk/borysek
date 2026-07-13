import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Link2, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { importProductsFromUrls } from "@/lib/pim/import-urls.functions";
import { friendlyError } from "@/lib/utils";

type Row = {
  url: string;
  status: "pending" | "processing" | "ok" | "error";
  name?: string;
  error?: string;
};

const BATCH_SIZE = 5;

type Props = {
  projectId: string;
  onDone?: () => void;
};

function parseUrls(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    try {
      const u = new URL(t);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        invalid.push(t);
        continue;
      }
      const key = u.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      valid.push(t);
    } catch {
      invalid.push(t);
    }
  }
  return { valid, invalid };
}

export function ImportUrlsDialog({ projectId, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState(0);
  const [stealth, setStealth] = useState(false);

  const qc = useQueryClient();
  const importFn = useServerFn(importProductsFromUrls);

  const parsed = useMemo(() => parseUrls(text), [text]);

  const reset = () => {
    setText("");
    setRows([]);
    setDone(0);
    setStealth(false);
  };

  const run = async () => {
    if (!parsed.valid.length) {
      toast.error("Wklej co najmniej jeden prawidłowy URL");
      return;
    }
    if (parsed.valid.length > 200) {
      toast.error("Maksymalnie 200 linków na jedną paczkę");
      return;
    }
    setBusy(true);
    setDone(0);
    const initialRows: Row[] = parsed.valid.map((u) => ({ url: u, status: "pending" }));
    setRows(initialRows);

    let okCount = 0;
    let errCount = 0;

    try {
      for (let i = 0; i < parsed.valid.length; i += BATCH_SIZE) {
        const batch = parsed.valid.slice(i, i + BATCH_SIZE);
        setRows((prev) =>
          prev.map((r) => (batch.includes(r.url) ? { ...r, status: "processing" } : r)),
        );
        try {
          const res = await importFn({ data: { projectId, urls: batch, stealth } });
          setRows((prev) => {
            const byUrl = new Map(res.results.map((x) => [x.url, x]));
            return prev.map((r) => {
              const hit = byUrl.get(r.url);
              if (!hit) return r;
              if (hit.ok) {
                okCount++;
                return { ...r, status: "ok", name: hit.name };
              }
              errCount++;
              return { ...r, status: "error", error: hit.error };
            });
          });
        } catch (e) {
          const msg = friendlyError(e, "Błąd importu");
          setRows((prev) =>
            prev.map((r) =>
              batch.includes(r.url) ? { ...r, status: "error", error: msg } : r,
            ),
          );
          errCount += batch.length;
        }
        setDone(i + batch.length);
      }
      if (okCount > 0) {
        toast.success(
          `Zaimportowano ${okCount} produkt${okCount === 1 ? "" : "y/ów"}${errCount ? `, ${errCount} błędów` : ""}. Kliknij „Dopasuj", aby powiązać źródła.`,
        );
      } else {
        toast.error(`Nie udało się zaimportować żadnego produktu (${errCount} błędów)`);
      }
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  const total = parsed.valid.length;
  const progressPct = total === 0 ? 0 : (done / total) * 100;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        setOpen(v);
        if (!v) reset();
      }}
    >
      <div className="border rounded-lg p-4 bg-card">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Dodaj z linków
            </h3>
            <p className="text-xs text-muted-foreground">
              Wklej URL-e stron produktowych — scrapujemy i zapisujemy jako produkty
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setOpen(true)}
        >
          <Link2 className="h-4 w-4 mr-2" />
          Dodaj z linków
        </Button>
      </div>

      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>Dodaj produkty z linków</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Wklej pełne adresy URL stron produktowych — jeden na linię (do 200).
            Firecrawl pobierze zawartość, AI wyciągnie nazwę, kod, EAN i opis, a
            reszta pipeline'u (Dopasuj, Generuj złote) zostaje w Twoich rękach.
          </p>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"https://sklep.pl/produkt-a\nhttps://producent.com/product-b\n..."}
            className="min-h-[140px] font-mono text-xs"
            disabled={busy}
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Prawidłowych: <b className="text-foreground">{parsed.valid.length}</b>
              {parsed.invalid.length > 0 && (
                <>
                  {" · "}
                  <span className="text-destructive">
                    Niepoprawnych: {parsed.invalid.length}
                  </span>
                </>
              )}
            </span>
            <span>Maks. 200 na paczkę · przetwarzane po {BATCH_SIZE}</span>
          </div>

          <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer hover:bg-muted/50">
            <Checkbox
              checked={stealth}
              onCheckedChange={(v) => setStealth(v === true)}
              disabled={busy}
              className="mt-0.5"
            />
            <span>
              <b>Tryb stealth</b> (wolniejszy, zużywa więcej kredytów Firecrawl) — użyj dla stron
              z Cloudflare / reCAPTCHA / Datadome. Bez tej opcji spróbujemy najpierw
              taniej ścieżki i włączymy stealth automatycznie, jeśli wykryjemy blokadę.
            </span>
          </label>

          {rows.length > 0 && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Postęp</span>
                  <span className="tabular-nums">
                    {done} / {total}
                  </span>
                </div>
                <Progress value={progressPct} />
              </div>

              <ScrollArea className="h-[280px] rounded border">
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li
                      key={r.url}
                      className="flex items-start gap-2 px-3 py-2 text-xs"
                    >
                      <span className="mt-0.5 shrink-0">
                        {r.status === "pending" && (
                          <span className="inline-block w-3 h-3 rounded-full border border-muted-foreground/40" />
                        )}
                        {r.status === "processing" && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                        {r.status === "ok" && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        )}
                        {r.status === "error" && (
                          <XCircle className="h-3.5 w-3.5 text-destructive" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono">{r.url}</div>
                        {r.status === "ok" && r.name && (
                          <div className="text-muted-foreground truncate">
                            → {r.name}
                          </div>
                        )}
                        {r.status === "error" && r.error && (
                          <div className="text-destructive truncate">
                            {r.error}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </>
          )}
        </div>

        <div className="shrink-0 border-t px-6 py-3 flex items-center justify-end gap-2 bg-background">
          <Button
            variant="ghost"
            onClick={() => {
              if (busy) return;
              setOpen(false);
              reset();
            }}
            disabled={busy}
          >
            {busy ? "Przetwarzam…" : "Zamknij"}
          </Button>
          <Button onClick={run} disabled={busy || parsed.valid.length === 0}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importuję…
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                Importuj {parsed.valid.length > 0 ? `(${parsed.valid.length})` : ""}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}