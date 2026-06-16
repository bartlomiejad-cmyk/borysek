import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Loader2, FileCheck } from "lucide-react";
import {
  parseCsvRaw,
  buildCsvRowsFromMapping,
  type RawCsv,
  type ExplicitCsvMapping,
} from "@/lib/pim/parsers";
import { ingestSourceProducts, clearProjectData } from "@/lib/pim/ingest.functions";
import { friendlyError } from "@/lib/utils";

type Field = "id_column" | "name_column" | "code_column" | "ean_column";
const FIELDS: Array<{ value: Field; label: string }> = [
  { value: "id_column", label: "ID (ext_id)" },
  { value: "name_column", label: "Nazwa" },
  { value: "code_column", label: "Kod / symbol" },
  { value: "ean_column", label: "EAN" },
];
const SKIP = "__skip__";

type Props = {
  projectId: string;
  count?: number;
  defaults?: ExplicitCsvMapping;
  onDone?: () => void;
};

export function ImportCsvDialog({ projectId, count, defaults, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<RawCsv | null>(null);
  const [mapping, setMapping] = useState<Record<Field, string>>({
    id_column: SKIP,
    name_column: SKIP,
    code_column: SKIP,
    ean_column: SKIP,
  });
  const [clearPrevious, setClearPrevious] = useState(true);
  const [busy, setBusy] = useState(false);

  const qc = useQueryClient();
  const ingestFn = useServerFn(ingestSourceProducts);
  const clearFn = useServerFn(clearProjectData);

  const headers = csv?.headers ?? [];
  const previewRows = csv?.rows.slice(0, 20) ?? [];

  // Map header -> short label of which field it's mapped to
  const headerToFieldLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of FIELDS) {
      const col = mapping[f.value];
      if (col && col !== SKIP) m.set(col, f.label);
    }
    return m;
  }, [mapping]);

  const reset = () => {
    setCsv(null);
    setMapping({ id_column: SKIP, name_column: SKIP, code_column: SKIP, ean_column: SKIP });
    setClearPrevious(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    try {
      const raw = await parseCsvRaw(file);
      if (!raw.headers.length || !raw.rows.length) {
        toast.error("Pusty plik CSV lub brak nagłówków");
        return;
      }
      setCsv(raw);
      const find = (name?: string | null) => {
        if (!name) return SKIP;
        const lk = name.trim().toLowerCase();
        const hit = raw.headers.find((h) => h.toLowerCase() === lk);
        return hit ?? SKIP;
      };
      setMapping({
        id_column: find(defaults?.id_column),
        name_column: find(defaults?.name_column),
        code_column: find(defaults?.code_column),
        ean_column: find(defaults?.ean_column),
      });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się wczytać CSV"));
    }
  };

  const canSubmit = useMemo(() => {
    if (!csv) return false;
    // Need at least one identifying field
    return FIELDS.some((f) => mapping[f.value] !== SKIP);
  }, [csv, mapping]);

  const handleSubmit = async () => {
    if (!csv) return;
    setBusy(true);
    try {
      const explicit: ExplicitCsvMapping = {
        id_column: mapping.id_column !== SKIP ? mapping.id_column : null,
        name_column: mapping.name_column !== SKIP ? mapping.name_column : null,
        code_column: mapping.code_column !== SKIP ? mapping.code_column : null,
        ean_column: mapping.ean_column !== SKIP ? mapping.ean_column : null,
      };
      const rows = buildCsvRowsFromMapping(csv, explicit);
      if (!rows.length) {
        toast.error("Brak wierszy z danymi po zastosowaniu mapowania");
        setBusy(false);
        return;
      }
      if (clearPrevious) {
        await clearFn({ data: { projectId, scope: "source_products" } });
      }
      const batchSize = 1000;
      for (let i = 0; i < rows.length; i += batchSize) {
        await ingestFn({ data: { projectId, rows: rows.slice(i, i + batchSize) } });
      }
      toast.success(`Wczytano ${rows.length} produktów`);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      onDone?.();
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się zaimportować CSV"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <div className="border rounded-lg p-4 bg-card">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              {count !== undefined && count > 0 ? (
                <FileCheck className="h-4 w-4 text-green-600" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Source CSV
            </h3>
            <p className="text-xs text-muted-foreground">Twoja baza: id, nazwa, kod, ean</p>
          </div>
          {count !== undefined && (
            <span className="text-xs text-muted-foreground">{count} wierszy</span>
          )}
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Wgraj produkty
        </Button>
      </div>

      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Wgraj produkty z CSV</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Wybierz plik, a następnie zmapuj kolumny CSV do pól produktu. Domyślne mapowanie pochodzi z ustawień projektu.
        </p>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload className="h-4 w-4 mr-2" />
            {csv ? `Wczytano: ${csv.rows.length} wierszy` : "Wybierz CSV"}
          </Button>
        </div>

        {csv && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-2 block">Mapowanie kolumn</Label>
              <div className="grid grid-cols-2 gap-3">
                {FIELDS.map((f) => (
                  <div key={f.value}>
                    <Label className="text-xs text-muted-foreground">{f.label}</Label>
                    <Select
                      value={mapping[f.value]}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [f.value]: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>— pomiń —</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Podgląd danych</Label>
                <span className="text-xs text-muted-foreground">
                  {csv.rows.length > previewRows.length
                    ? `Pokazano ${previewRows.length} z ${csv.rows.length} wierszy`
                    : `${csv.rows.length} wierszy`}
                </span>
              </div>
              <ScrollArea className="h-[280px] w-full rounded-md border">
                <div className="min-w-max">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {headers.map((h) => {
                          const label = headerToFieldLabel.get(h);
                          return (
                            <TableHead
                              key={h}
                              className={`whitespace-nowrap ${label ? "bg-primary/10" : ""}`}
                            >
                              <div className="font-medium">{h}</div>
                              {label && (
                                <div className="text-[10px] uppercase tracking-wider text-primary">
                                  {label}
                                </div>
                              )}
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row, i) => (
                        <TableRow key={i}>
                          {headers.map((h) => {
                            const v = row[h] ?? "";
                            const short = v.length > 80 ? v.slice(0, 80) + "…" : v;
                            const mapped = headerToFieldLabel.has(h);
                            return (
                              <TableCell
                                key={h}
                                title={v}
                                className={`whitespace-nowrap text-xs ${mapped ? "bg-primary/5" : ""}`}
                              >
                                {short}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="clear-previous"
                checked={clearPrevious}
                onCheckedChange={(v) => setClearPrevious(v === true)}
              />
              <Label htmlFor="clear-previous" className="text-xs cursor-pointer">
                Wyczyść poprzednie produkty przed importem (usuwa też wyniki AI)
              </Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Anuluj
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || busy}>
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Wczytaj
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}