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
import { Upload, Loader2, Wand2 } from "lucide-react";
import { parseCsvRaw, type RawCsv } from "@/lib/pim/parsers";
import { updateSourceProductsFromCsv } from "@/lib/pim/ingest.functions";
import { friendlyError } from "@/lib/utils";

type Field = "ext_id" | "nazwa" | "kod" | "ean";
const FIELDS: Array<{ value: Field; label: string }> = [
  { value: "ext_id", label: "ID (ext_id)" },
  { value: "nazwa", label: "Nazwa" },
  { value: "kod", label: "Kod / symbol" },
  { value: "ean", label: "EAN" },
];
const SKIP = "__skip__";

type Props = {
  projectId: string;
  defaults?: {
    id_column?: string;
    name_column?: string;
    code_column?: string;
    ean_column?: string;
  };
  onDone?: () => void;
};

export function RemapCsvDialog({ projectId, defaults, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<RawCsv | null>(null);
  const [keyField, setKeyField] = useState<Field>("ext_id");
  const [keyColumn, setKeyColumn] = useState<string>("");
  const [mapping, setMapping] = useState<Record<Field, string>>({
    ext_id: SKIP,
    nazwa: SKIP,
    kod: SKIP,
    ean: SKIP,
  });
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  const qc = useQueryClient();
  const updateFn = useServerFn(updateSourceProductsFromCsv);

  const headers = csv?.headers ?? [];

  const reset = () => {
    setCsv(null);
    setKeyColumn("");
    setMapping({ ext_id: SKIP, nazwa: SKIP, kod: SKIP, ean: SKIP });
    setOverwrite(false);
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
      // Pre-fill mapping from project defaults where the header exists.
      const find = (name?: string) => {
        if (!name) return SKIP;
        const lk = name.trim().toLowerCase();
        const hit = raw.headers.find((h) => h.toLowerCase() === lk);
        return hit ?? SKIP;
      };
      const initial: Record<Field, string> = {
        ext_id: find(defaults?.id_column),
        nazwa: find(defaults?.name_column),
        kod: find(defaults?.code_column),
        ean: find(defaults?.ean_column),
      };
      setMapping(initial);
      // Default key column to whatever column was matched to the key field.
      const initialKey = initial[keyField];
      setKeyColumn(initialKey !== SKIP ? initialKey : raw.headers[0]);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się wczytać CSV"));
    }
  };

  const canSubmit = useMemo(() => {
    if (!csv || !keyColumn) return false;
    return FIELDS.some(({ value }) => value !== keyField && mapping[value] !== SKIP);
  }, [csv, keyColumn, keyField, mapping]);

  const onKeyFieldChange = (v: Field) => {
    setKeyField(v);
    // If the chosen field already has a mapped column, use it as the default key column.
    const mapped = mapping[v];
    if (mapped && mapped !== SKIP) setKeyColumn(mapped);
  };

  const handleSubmit = async () => {
    if (!csv || !keyColumn) return;
    setBusy(true);
    try {
      const rows = csv.rows
        .map((r) => {
          const key = (r[keyColumn] ?? "").trim();
          if (!key) return null;
          const out: { key: string; ext_id?: string | null; nazwa?: string | null; kod?: string | null; ean?: string | null } = { key };
          for (const { value } of FIELDS) {
            const col = mapping[value];
            if (!col || col === SKIP) continue;
            const v = (r[col] ?? "").trim();
            if (v) out[value] = v;
          }
          return out;
        })
        .filter((r): r is { key: string } => r !== null);

      if (!rows.length) {
        toast.error("Brak wierszy z wartością w kolumnie klucza");
        setBusy(false);
        return;
      }

      const res = await updateFn({
        data: { projectId, keyField, overwrite, rows },
      });
      toast.success(
        `Zaktualizowano ${res.updated} produktów (dopasowano ${res.matched}, niedopasowano ${res.unmatched}, pominięto ${res.skipped})`,
      );
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      onDone?.();
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się zaktualizować produktów"));
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
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Wand2 className="h-4 w-4 mr-2" />
        Uzupełnij dane z CSV
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Uzupełnij dane z CSV</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Dograj brakujące pola (kod, EAN, nazwa, ID) do już istniejących produktów. Dane AI, scraping i ukryte zdjęcia zostają nietknięte.
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Pole klucza (w bazie)</Label>
                <Select value={keyField} onValueChange={(v) => onKeyFieldChange(v as Field)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Kolumna klucza (w CSV)</Label>
                <Select value={keyColumn} onValueChange={setKeyColumn}>
                  <SelectTrigger><SelectValue placeholder="Wybierz..." /></SelectTrigger>
                  <SelectContent>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t pt-3">
              <Label className="text-xs mb-2 block">Mapowanie pól docelowych</Label>
              <div className="grid grid-cols-2 gap-3">
                {FIELDS.map((f) => (
                  <div key={f.value}>
                    <Label className="text-xs text-muted-foreground">{f.label}</Label>
                    <Select
                      value={mapping[f.value]}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [f.value]: v }))}
                      disabled={f.value === keyField}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
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

            <div className="flex items-center gap-2">
              <Checkbox
                id="overwrite"
                checked={overwrite}
                onCheckedChange={(v) => setOverwrite(v === true)}
              />
              <Label htmlFor="overwrite" className="text-xs cursor-pointer">
                Nadpisuj istniejące wartości (domyślnie wypełnia tylko puste)
              </Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Anuluj
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || busy}>
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Zastosuj
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}