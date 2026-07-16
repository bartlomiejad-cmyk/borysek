import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Lock, Loader2 } from "lucide-react";
import {
  exportRoundtrip,
  isBlockedHeader,
  ROUNDTRIP_APPENDED,
  ROUNDTRIP_SOURCE_FIELDS,
  type RoundtripAppendedKey,
  type RoundtripSourceField,
} from "@/lib/pim/roundtrip-export.functions";
import { friendlyError } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  importMeta:
    | {
        headers: string[];
        filename: string;
        sheet_name: string | null;
        format: "csv" | "xlsx";
        delimiter: string | null;
      }
    | null;
  savedMapping?: {
    updates?: Record<string, RoundtripSourceField>;
    appended?: RoundtripAppendedKey[];
    propagateToVariants?: boolean;
    approvedOnly?: boolean;
  } | null;
};

const FIELD_LABELS: Record<RoundtripSourceField, string> = {
  golden_name: "Nazwa (golden_name)",
  golden_description: "Opis (golden_description)",
  golden_meta_description: "Meta description (SEO)",
  golden_slug: "Slug",
  opis_allegro: "Opis Allegro (HTML)",
  kategoria: "Kategoria",
};

const SKIP = "__skip__";

// Auto-propose mapping heuristic on original header name.
function autoProposeField(header: string): RoundtripSourceField | null {
  const h = header.toLowerCase();
  if (/(seo[_ ]?descr|meta[_ ]?descr|opis[_ ]?meta)/.test(h)) return "golden_meta_description";
  if (/(seo[_ ]?title)/.test(h)) return "golden_name";
  if (/(nazwa|name|title|tytul)/.test(h)) return "golden_name";
  if (/(opis[_ ]?html|opis[_ ]?long|description[_ ]?long|opis$|description$)/.test(h)) return "golden_description";
  if (/(slug|url[_ ]?key)/.test(h)) return "golden_slug";
  if (/(kategor|category)/.test(h)) return "kategoria";
  if (/(allegro)/.test(h)) return "opis_allegro";
  return null;
}

export function RoundtripExportDialog({ open, onOpenChange, projectId, importMeta, savedMapping }: Props) {
  const runExport = useServerFn(exportRoundtrip);
  const [updates, setUpdates] = useState<Record<string, RoundtripSourceField | typeof SKIP>>({});
  const [appended, setAppended] = useState<Set<RoundtripAppendedKey>>(new Set());
  const [propagate, setPropagate] = useState(true);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const headers = useMemo(() => importMeta?.headers ?? [], [importMeta]);

  useEffect(() => {
    if (!open || !importMeta) return;
    const init: Record<string, RoundtripSourceField | typeof SKIP> = {};
    for (const h of headers) {
      if (isBlockedHeader(h)) { init[h] = SKIP; continue; }
      const saved = savedMapping?.updates?.[h];
      if (saved) { init[h] = saved; continue; }
      const proposed = autoProposeField(h);
      init[h] = proposed ?? SKIP;
    }
    setUpdates(init);
    setAppended(new Set(savedMapping?.appended ?? ["opis_html", "cechy", "slowa_kluczowe"]));
    setPropagate(savedMapping?.propagateToVariants ?? true);
    setApprovedOnly(savedMapping?.approvedOnly ?? false);
  }, [open, importMeta, headers, savedMapping]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    if (!importMeta) return;
    const validUpdates: Record<string, RoundtripSourceField> = {};
    for (const [h, v] of Object.entries(updates)) {
      if (v === SKIP) continue;
      if (isBlockedHeader(h)) continue;
      validUpdates[h] = v;
    }
    setBusy(true);
    try {
      const res = await runExport({
        data: {
          projectId,
          mapping: {
            updates: validUpdates,
            appended: Array.from(appended),
            propagateToVariants: propagate,
            approvedOnly,
          },
        },
      });
      const outName = importMeta.filename.replace(/\.(xlsx|csv)$/i, "") + "_updated";
      if (res.format === "xlsx") {
        const ws = XLSX.utils.json_to_sheet(res.rows, { header: res.headers });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, res.sheet_name || "Sheet1");
        const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        downloadBlob(new Blob([out], { type: "application/octet-stream" }), `${outName}.xlsx`);
      } else {
        const delim = res.delimiter || ";";
        const csv =
          "\uFEFF" +
          Papa.unparse(res.rows as unknown as object[], {
            columns: res.headers,
            delimiter: delim,
            newline: "\r\n",
            quotes: true,
          });
        downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${outName}.csv`);
      }
      toast.success(`Wyeksportowano ${res.rows.length} wierszy`);
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, "Eksport nie powiódł się"));
    } finally {
      setBusy(false);
    }
  };

  if (!importMeta) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Plik klienta (aktualizacja)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Brak zapisanej struktury oryginalnego pliku importu. Zaimportuj plik od nowa,
            aby użyć eksportu round-trip (nagłówki i kolejność wierszy zostaną zapamiętane).
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Eksport: Plik klienta (aktualizacja)</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Odtwarza {importMeta.filename} ({importMeta.format.toUpperCase()}
          {importMeta.sheet_name ? ` · arkusz "${importMeta.sheet_name}"` : ""}
          ) z zachowaniem kolejności wierszy i wszystkich kolumn oryginału. Aktualizuje tylko
          wybrane pola; kolumny identyfikacyjne (EAN/SKU/kod/ID) są zablokowane.
          Eksport odtwarza dane i układ kolumn, nie formatowanie Excela.
        </p>

        <div className="flex-1 overflow-y-auto space-y-6 py-2 pr-1">
          <section>
            <h3 className="text-sm font-semibold mb-2">Aktualizuj istniejące kolumny</h3>
            <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
              {headers.map((h) => {
                const blocked = isBlockedHeader(h);
                const value = updates[h] ?? SKIP;
                return (
                  <div key={h} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <div className={`flex-1 truncate ${blocked ? "text-muted-foreground" : ""}`}>
                      {blocked && <Lock className="h-3 w-3 inline mr-1" />}
                      {h}
                    </div>
                    <Select
                      disabled={blocked}
                      value={value}
                      onValueChange={(v) =>
                        setUpdates((prev) => ({ ...prev, [h]: v as RoundtripSourceField | typeof SKIP }))
                      }
                    >
                      <SelectTrigger className="h-7 w-64 text-xs">
                        <SelectValue placeholder="— nie aktualizuj —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>— nie aktualizuj —</SelectItem>
                        {ROUNDTRIP_SOURCE_FIELDS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {FIELD_LABELS[f]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">Dodaj nowe kolumny (na końcu)</h3>
            <div className="grid grid-cols-2 gap-2">
              {ROUNDTRIP_APPENDED.map((a) => (
                <label key={a.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={appended.has(a.key)}
                    onCheckedChange={(v) => {
                      setAppended((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(a.key);
                        else next.delete(a.key);
                        return next;
                      });
                    }}
                  />
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={propagate} onCheckedChange={(v) => setPropagate(v === true)} />
              <span>Powiel treści rodzica na warianty</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={approvedOnly} onCheckedChange={(v) => setApprovedOnly(v === true)} />
              <span>Aktualizuj tylko zatwierdzone (pozostałe wiersze bez zmian)</span>
            </label>
          </section>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Anuluj
          </Button>
          <Button onClick={handleExport} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Pobierz plik
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}